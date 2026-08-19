import { useCallback, type KeyboardEvent, type RefObject } from "react";

export type EnterNavField = {
  ref: RefObject<HTMLElement | null>;
  kind?: "input" | "textarea" | "custom";
  /** textarea: Enter = newline; Ctrl+Enter = submit */
  onEnter?: (e: KeyboardEvent) => boolean | void;
};

export function useFormEnterNavigation(
  fields: EnterNavField[],
  onSubmit: () => void,
) {
  const focusIndex = useCallback((index: number) => {
    const el = fields[index]?.ref.current;
    if (!el) return;
    if ("focus" in el && typeof el.focus === "function") {
      el.focus();
      if ("select" in el && typeof (el as HTMLInputElement).select === "function") {
        try {
          (el as HTMLInputElement).select();
        } catch {
          /* noop */
        }
      }
    }
  }, [fields]);

  const handleEnterKeyDown = useCallback(
    (index: number) => (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;

      const field = fields[index];
      if (!field) return;

      if (field.kind === "textarea") {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          onSubmit();
        }
        return;
      }

      if (field.onEnter) {
        const handled = field.onEnter(e);
        if (handled === true) return;
      }

      e.preventDefault();
      if (index < fields.length - 1) {
        focusIndex(index + 1);
      } else {
        onSubmit();
      }
    },
    [fields, focusIndex, onSubmit],
  );

  return { handleEnterKeyDown, focusIndex };
}
