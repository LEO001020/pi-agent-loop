//! Tray / menu-bar copy — mirrors `tray.*` keys in `src/i18n/messages.ts`.
//! Native menus cannot use the frontend catalog; keep both sides in sync.
//!
//! The product ships English only, matching `Locale` in `src/i18n/messages.ts`.
//! Adding a locale here means adding it there too, and reintroducing a lookup.

/// Static tray strings.
pub struct TrayStrings {
    pub recent: &'static str,
    pub no_recent: &'static str,
    pub untitled: &'static str,
    pub more: &'static str,
    pub settings: &'static str,
    pub doctor: &'static str,
    pub account: &'static str,
    pub new_chat: &'static str,
    pub open_app: &'static str,
    pub quit: &'static str,
    pub tooltip: &'static str,
    /// `Usage  ·  {pct}% left  ·  {time}`
    pub usage_with_reset: &'static str,
    /// `Usage  ·  {pct}% left`
    pub usage_pct: &'static str,
    /// `Usage  ·  —`
    pub usage_unknown: &'static str,
}

const EN: TrayStrings = TrayStrings {
    recent: "Recent",
    no_recent: "No recent chats",
    untitled: "Untitled",
    more: "More",
    settings: "Settings…",
    doctor: "Doctor",
    account: "Account",
    new_chat: "New Chat",
    open_app: "Open Pi",
    quit: "Quit Pi",
    tooltip: "Pi",
    usage_with_reset: "Usage  ·  {pct}% left  ·  {time}",
    usage_pct: "Usage  ·  {pct}% left",
    usage_unknown: "Usage  ·  —",
};

pub fn t() -> &'static TrayStrings {
    &EN
}

/// Fill `{pct}` / `{time}` placeholders in tray usage templates.
pub fn format_usage(template: &str, pct: Option<f64>, time: Option<&str>) -> String {
    let mut out = template.to_string();
    if let Some(p) = pct {
        out = out.replace("{pct}", &format!("{p:.0}"));
    }
    if let Some(t) = time {
        out = out.replace("{time}", t);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_templates_fill() {
        let s = format_usage(EN.usage_with_reset, Some(73.2), Some("04-15 09:05"));
        assert_eq!(s, "Usage  ·  73% left  ·  04-15 09:05");
        let p = format_usage(EN.usage_pct, Some(73.0), None);
        assert_eq!(p, "Usage  ·  73% left");
    }
}
