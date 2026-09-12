import { Mark, type MarkSpec } from "../app/mark/Mark";

// One mark at the sizes Windows draws an icon, on a dark and a light ground. Dev only.
const LARGE = 192;
const SMALL = [96, 48, 32, 24, 16];
const GROUNDS = [
  { name: "dark", className: "bg-ground" },
  { name: "light", className: "bg-[#f3f3f3]" },
];

export function MarkLadder({ spec }: { spec: MarkSpec }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto p-4">
      {GROUNDS.map((ground) => (
        <div
          key={ground.name}
          className={`flex w-full flex-col items-center gap-4 p-4 ${ground.className}`}
        >
          <Mark spec={spec} style={{ width: LARGE, height: LARGE }} />
          <div className="flex items-end gap-4">
            {SMALL.map((size) => (
              <Mark key={size} spec={spec} style={{ width: size, height: size }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
