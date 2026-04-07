"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SuggestionInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  maxOptions?: number;
  containerClassName?: string;
}

function normalizeSuggestion(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

export function SuggestionInput({
  value,
  onValueChange,
  options,
  maxOptions = 12,
  className,
  containerClassName,
  disabled,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: SuggestionInputProps) {
  const listId = React.useId();
  const hideTimeoutRef = React.useRef<number | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const [hasTypedSinceFocus, setHasTypedSinceFocus] = React.useState(false);

  const filteredOptions = React.useMemo(() => {
    const query = hasTypedSinceFocus ? normalizeSuggestion(value) : "";
    return options
      .filter((option, index, array) => array.indexOf(option) === index)
      .filter((option) => {
        if (!query) return true;
        return normalizeSuggestion(option).includes(query);
      })
      .slice(0, maxOptions);
  }, [hasTypedSinceFocus, maxOptions, options, value]);

  const clearHideTimeout = React.useCallback(() => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  React.useEffect(() => () => clearHideTimeout(), [clearHideTimeout]);

  React.useEffect(() => {
    if (!filteredOptions.length) {
      setHighlightedIndex(-1);
      return;
    }

    setHighlightedIndex((prev) => {
      if (prev < 0) return -1;
      return Math.min(prev, filteredOptions.length - 1);
    });
  }, [filteredOptions]);

  const openList = React.useCallback(() => {
    if (!disabled && filteredOptions.length > 0) {
      setIsOpen(true);
    }
  }, [disabled, filteredOptions.length]);

  const closeList = React.useCallback(() => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    setHasTypedSinceFocus(false);
  }, []);

  const handleSelect = React.useCallback(
    (nextValue: string) => {
      onValueChange(nextValue);
      closeList();
    },
    [closeList, onValueChange],
  );

  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        {...props}
        value={value}
        disabled={disabled}
        className={className}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={isOpen && filteredOptions.length > 0}
        aria-controls={listId}
        onFocus={(event) => {
          clearHideTimeout();
          setHasTypedSinceFocus(false);
          openList();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          clearHideTimeout();
          hideTimeoutRef.current = window.setTimeout(() => {
            closeList();
          }, 120);
          onBlur?.(event);
        }}
        onChange={(event) => {
          setHasTypedSinceFocus(true);
          onValueChange(event.target.value);
          if (!disabled) {
            setIsOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            if (!filteredOptions.length) {
              onKeyDown?.(event);
              return;
            }
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((prev) => {
              if (prev < 0) return 0;
              return Math.min(prev + 1, filteredOptions.length - 1);
            });
            return;
          }

          if (event.key === "ArrowUp") {
            if (!filteredOptions.length) {
              onKeyDown?.(event);
              return;
            }
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((prev) => {
              if (prev <= 0) return 0;
              return prev - 1;
            });
            return;
          }

          if (event.key === "Enter" && isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
            event.preventDefault();
            handleSelect(filteredOptions[highlightedIndex]);
            return;
          }

          if (event.key === "Escape") {
            closeList();
          }

          onKeyDown?.(event);
        }}
      />

      {isOpen && filteredOptions.length > 0 ? (
        <div
          id={listId}
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
          role="listbox"
        >
          {filteredOptions.map((option, index) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={highlightedIndex === index}
              className={cn(
                "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                highlightedIndex === index && "bg-zinc-100 dark:bg-zinc-800",
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                handleSelect(option);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
