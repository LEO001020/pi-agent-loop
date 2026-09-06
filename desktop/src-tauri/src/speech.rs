//! Local speech-to-text bridge.
//!
//! Models stay outside the app bundle and are installed only after an explicit
//! user action. Parakeet MLX is preferred on Apple Silicon; MLX Whisper is the
//! local fallback. Audio never leaves the machine.

use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::process::Command;

const PARAKEET_MODEL: &str = "mlx-community/parakeet-tdt-0.6b-v3";
const WHISPER_MODEL: &str = "mlx-community/whisper-small-mlx";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStatus {
    pub supported: bool,
    pub parakeet_available: bool,
    pub whisper_available: bool,
    pub uv_available: bool,
    pub ffmpeg_available: bool,
    pub recommended_engine: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTranscription {
    pub text: String,
    pub engine: String,
}

fn executable(names: &[&str]) -> Option<PathBuf> {
    names.iter().find_map(|name| {
        which::which(name).ok().or_else(|| {
            let home = crate::process_util::user_home();
            [
                home.join(".local").join("bin").join(name),
                home.join(".cargo").join("bin").join(name),
                PathBuf::from("/opt/homebrew/bin").join(name),
                PathBuf::from("/usr/local/bin").join(name),
            ]
            .into_iter()
            .find(|path| path.is_file())
        })
    })
}

fn supported_platform() -> bool {
    cfg!(target_os = "macos") && cfg!(target_arch = "aarch64")
}

fn current_status() -> SpeechStatus {
    let parakeet_available = executable(&["parakeet-mlx"]).is_some();
    let whisper_available = executable(&["mlx_whisper"]).is_some();
    let supported = supported_platform();
    SpeechStatus {
        supported,
        parakeet_available,
        whisper_available,
        uv_available: executable(&["uv"]).is_some(),
        ffmpeg_available: executable(&["ffmpeg"]).is_some(),
        recommended_engine: if parakeet_available {
            "parakeet".into()
        } else {
            "whisper".into()
        },
        reason: (!supported)
            .then(|| "MLX speech currently requires a Mac with Apple Silicon.".into()),
    }
}

#[tauri::command]
pub async fn speech_status() -> Result<SpeechStatus, String> {
    Ok(current_status())
}

#[tauri::command]
pub async fn speech_install(engine: String) -> Result<SpeechStatus, String> {
    if !supported_platform() {
        return Err("SPEECH_UNSUPPORTED: MLX speech requires Apple Silicon".into());
    }
    let uv = executable(&["uv"])
        .ok_or("SPEECH_UV_MISSING: Install uv from https://docs.astral.sh/uv/")?;
    let package = match engine.as_str() {
        "parakeet" => "parakeet-mlx",
        "whisper" => "mlx-whisper",
        _ => return Err("SPEECH_ENGINE_INVALID".into()),
    };
    let output = Command::new(uv)
        .args(["tool", "install", package, "--upgrade"])
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|error| format!("SPEECH_INSTALL_FAILED: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SPEECH_INSTALL_FAILED: {}", stderr.trim()));
    }
    Ok(current_status())
}

async fn run_parakeet(audio: &Path, output_dir: &Path) -> Result<String, String> {
    let binary = executable(&["parakeet-mlx"]).ok_or("SPEECH_PARAKEET_MISSING")?;
    let mut command = Command::new(binary);
    command
        .arg(audio)
        .args([
            "--output-dir",
            output_dir.to_string_lossy().as_ref(),
            "--output-format",
            "txt",
            "--model",
            PARAKEET_MODEL,
        ])
        .env(
            "HF_HOME",
            crate::paths::app_data_root().join("speech").join("models"),
        )
        .kill_on_drop(true);
    let output = command
        .output()
        .await
        .map_err(|error| format!("SPEECH_PARAKEET_FAILED: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "SPEECH_PARAKEET_FAILED: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    read_transcript(output_dir, audio)
}

async fn run_whisper(
    audio: &Path,
    output_dir: &Path,
    language: Option<&str>,
) -> Result<String, String> {
    let binary = executable(&["mlx_whisper"]).ok_or("SPEECH_WHISPER_MISSING")?;
    let mut command = Command::new(binary);
    command
        .arg(audio)
        .args([
            "--output-dir",
            output_dir.to_string_lossy().as_ref(),
            "--output-format",
            "txt",
            "--model",
            WHISPER_MODEL,
        ])
        .env(
            "HF_HOME",
            crate::paths::app_data_root().join("speech").join("models"),
        )
        .kill_on_drop(true);
    if let Some(language) = language.filter(|value| *value != "auto") {
        command.args(["--language", language]);
    }
    let output = command
        .output()
        .await
        .map_err(|error| format!("SPEECH_WHISPER_FAILED: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "SPEECH_WHISPER_FAILED: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    read_transcript(output_dir, audio)
}

fn read_transcript(output_dir: &Path, audio: &Path) -> Result<String, String> {
    let stem = audio
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("SPEECH_OUTPUT_INVALID")?;
    let path = output_dir.join(format!("{stem}.txt"));
    let text =
        std::fs::read_to_string(path).map_err(|error| format!("SPEECH_OUTPUT_MISSING: {error}"))?;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("SPEECH_NO_SPEECH".into());
    }
    Ok(text)
}

#[tauri::command]
pub async fn speech_transcribe(
    audio_base64: String,
    engine: Option<String>,
    language: Option<String>,
) -> Result<SpeechTranscription, String> {
    if !supported_platform() {
        return Err("SPEECH_UNSUPPORTED".into());
    }
    if audio_base64.len() > 48 * 1024 * 1024 {
        return Err("SPEECH_AUDIO_TOO_LARGE".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64)
        .map_err(|error| format!("SPEECH_AUDIO_INVALID: {error}"))?;
    if bytes.len() < 128 {
        return Err("SPEECH_NO_SPEECH".into());
    }

    let root = crate::paths::app_data_root()
        .join("speech")
        .join("tmp")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&root).map_err(|error| format!("SPEECH_IO_FAILED: {error}"))?;
    let audio = root.join("dictation.wav");
    std::fs::write(&audio, bytes).map_err(|error| format!("SPEECH_IO_FAILED: {error}"))?;

    let requested = engine.as_deref().unwrap_or("auto");
    let result = match requested {
        "parakeet" => run_parakeet(&audio, &root)
            .await
            .map(|text| (text, "parakeet")),
        "whisper" => run_whisper(&audio, &root, language.as_deref())
            .await
            .map(|text| (text, "whisper")),
        "auto" => match run_parakeet(&audio, &root).await {
            Ok(text) => Ok((text, "parakeet")),
            Err(_) => run_whisper(&audio, &root, language.as_deref())
                .await
                .map(|text| (text, "whisper")),
        },
        _ => Err("SPEECH_ENGINE_INVALID".into()),
    };
    let _ = std::fs::remove_dir_all(&root);
    result.map(|(text, engine)| SpeechTranscription {
        text,
        engine: engine.into(),
    })
}
