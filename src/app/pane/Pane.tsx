import { Details, Title } from "./Details";
import { Media } from "./Media";
import { usePaneItem } from "./pane-store";
import { useItemDetail } from "./useItemDetail";

/** The item last clicked in the grid, its picture above everything known about it. PRODUCT.md "The three panels". */
export function Pane() {
  const shown = useItemDetail(usePaneItem());
  if (shown.status === "loading") return null;
  if (shown.status !== "ready") {
    return (
      <p className="m-0 px-3 py-2 text-fg-dim text-ui">
        {shown.status === "gone"
          ? "This file is no longer here."
          : "Click a picture to see it here."}
      </p>
    );
  }
  const { item, tags } = shown;
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <Media key={item.id} item={item} />
      <Title item={item} />
      <Details item={item} tags={tags} />
    </div>
  );
}
