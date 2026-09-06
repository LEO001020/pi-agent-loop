import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu, type FloatingPlacement } from "@/lib/floatingMenu";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** compact chip-style in composer */
  variant?: "default" | "chip";
  /** Menu open direction. chip defaults to auto (prefer up near composer). */
  placement?: FloatingPlacement;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
}

/** Custom dropdown — menu portaled to body (never clipped by overflow parents). */
export function Select({
  value,
  options,
  onChange,
  variant = "default",
  placement,
  className = "",
  disabled,
  "aria-label": ariaLabel,
  title,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? options[0];
  const menuPlacement: FloatingPlacement =
    placement ?? (variant === "chip" ? "auto" : "down");

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef,
    panelRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: menuPlacement,
    fitContent: true,
    // At least as wide as the trigger; grow when option labels are longer.
    matchTriggerWidth: true,
    estHeight: Math.min(280, 40 + options.length * 36),
  });

  const menu =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={panelRef}
            className="menu-panel c-select__menu c-select__menu--portal"
            role="listbox"
            id={listId}
            style={style}
          >
            {options.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                <button
                  type="button"
                  className={
                    "c-select__option" +
                    (o.value === value ? " is-selected" : "") +
                    (o.disabled ? " is-disabled" : "")
                  }
                  disabled={o.disabled}
                  onClick={() => {
                    if (o.disabled) return;
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="c-select__trigger"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-label={ariaLabel}
      onClick={() => !disabled && setOpen((v) => !v)}
    >
      <span className="c-select__value">{selected?.label ?? value}</span>
      <span className="c-select__chev" aria-hidden>
        <IconChevronDown size={14} />
      </span>
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={`c-select c-select--${variant} ${open ? "is-open" : ""} ${className}`}
    >
      {title ? <Tip label={title}>{trigger}</Tip> : trigger}
      {menu}
    </div>
  );
}
