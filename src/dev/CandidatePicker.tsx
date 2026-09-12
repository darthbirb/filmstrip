import { chooseCandidate } from "../app/candidates";

type Props = { slice: string; names: readonly string[]; current: string };

/** Switches a slice between its candidates, so the user can compare them in the real window. */
export function CandidatePicker({ slice, names, current }: Props) {
  return (
    <label className="flex items-center gap-1">
      {slice}
      <select
        value={current}
        onChange={(event) => chooseCandidate(slice, event.target.value)}
        className="bg-ground"
      >
        {names.map((name) => (
          <option key={name}>{name}</option>
        ))}
      </select>
    </label>
  );
}
