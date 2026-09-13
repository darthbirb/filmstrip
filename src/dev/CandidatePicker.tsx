import { useEffect } from "react";

type Props<T extends string> = {
  slice: string;
  names: readonly T[];
  current: T;
  onChoose: (name: T) => void;
};

/** Switches a slice between its candidates live, by click or by the digit shown beside each. */
export function CandidatePicker<T extends string>({ slice, names, current, onChoose }: Props<T>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      const name = names[Number(event.key) - 1];
      if (name) onChoose(name);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [names, onChoose]);

  return (
    <fieldset aria-label={`${slice} candidates`} className="flex items-center gap-1">
      <span className="opacity-60">{slice}</span>
      {names.map((name, index) => (
        <button
          key={name}
          type="button"
          aria-pressed={name === current}
          onClick={() => onChoose(name)}
          className={`focus-ring px-2 ${name === current ? "bg-raised-hi text-fg" : "opacity-60"}`}
        >
          {index + 1} {name}
        </button>
      ))}
    </fieldset>
  );
}
