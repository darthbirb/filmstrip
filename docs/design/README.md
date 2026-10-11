# Designs

The drawn sheets the interface is built from, one file per sheet, with the `support.js` that
renders them; open one in a browser. They load fonts and icons from the network to draw, which
suits a reference and is never true of the app. Biome skips the folder, and nothing in `src/`
imports from it.

| Sheet | Holds |
| --- | --- |
| `tokens.dc.html` | the token sheet |
| `components.dc.html` | the primitives |
| `artboards.dc.html` | whole surfaces |
| `pane.dc.html` | the pane |
| `notes.dc.html` | notes beside the drawings |
| `ggallery-drawing.html` | the predecessor's drawing, for structure and behaviour only |

`BACKLOG.md` is what the next pass draws. The `design-pass` skill draws it on the canvas and
brings the sheets back here.

**Canvas:** none yet — the first design pass creates it and links it here.
