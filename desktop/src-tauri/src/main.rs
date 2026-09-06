// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args().skip(1);
    let first = args.next();
    let second = args.next();
    if first.as_deref() == Some("mcp") && second.as_deref() == Some("serve") {
        if let Err(error) = pi_app_lib::run_mcp_stdio() {
            eprintln!("pi-app mcp serve: {error}");
            std::process::exit(1);
        }
        return;
    }
    if first.as_deref() == Some("mcp") && second.as_deref() == Some("revoke") {
        if let Err(error) = pi_app_lib::revoke_mcp_runtime_token() {
            eprintln!("pi-app mcp revoke: {error}");
            std::process::exit(1);
        }
        return;
    }
    if first.as_deref() == Some("mcp") && second.as_deref() == Some("unrevoke") {
        if let Err(error) = pi_app_lib::clear_mcp_runtime_token_revocation() {
            eprintln!("pi-app mcp unrevoke: {error}");
            std::process::exit(1);
        }
        return;
    }
    if first.as_deref() == Some("automation") && second.as_deref() == Some("daemon") {
        if let Err(error) = pi_app_lib::run_automation_daemon() {
            eprintln!("pi-app automation daemon: {error}");
            std::process::exit(1);
        }
        return;
    }
    pi_app_lib::run();
}
