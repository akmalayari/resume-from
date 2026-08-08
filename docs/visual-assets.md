# Visual assets

The project uses one source illustration and one rendered package image.

| Asset                         | Purpose                                             | Format          |
| ----------------------------- | --------------------------------------------------- | --------------- |
| `assets/resume-from-card.svg` | README front-page illustration and editable source. | 1600 × 1000 SVG |
| `assets/resume-from-card.png` | Pi package gallery image and social-preview source. | 1600 × 1000 PNG |

## What the illustration explains

The layout follows the actual transfer pipeline from left to right:

1. **Source session** — native history in Pi, Claude Code, or Codex.
2. **Safe transfer** — normalize, filter and budget, then preview and confirm.
3. **Target session** — a new native session opened with the destination agent.

The bottom row distinguishes content that is kept, made safe, and removed. The source card states that the original session remains unchanged.

The use-case chips name the primary reasons for a transfer: another model, harness, profile, or destination after usage limits.

## Visual system

### Color roles

| Role           | Main color             | Meaning                                |
| -------------- | ---------------------- | -------------------------------------- |
| Background     | `#080D19` to `#10182B` | Neutral terminal surface.              |
| Cyan           | `#38BDF8`              | Source session and input flow.         |
| Violet         | `#A78BFA`              | Format conversion and safety boundary. |
| Amber          | `#FBBF24`              | New target-native session.             |
| Green          | `#34D399`              | Source-preservation guarantee.         |
| Primary text   | `#F8FAFC`              | High-contrast headings.                |
| Secondary text | `#94A3B8`              | Supporting descriptions.               |

The colors identify roles, not vendors. The illustration contains no vendor logos or copied interface elements.

### Typography

- Product name, stage labels, and transfer notation use a system monospace stack: SFMono, Consolas, Liberation Mono, Menlo.
- Titles and descriptions use a system sans-serif stack: Inter when available, then the operating-system UI font.
- The SVG embeds no external font files, so GitHub and package renderers do not need a network request.

### Layout

- Canvas: 8:5, matching the Pi package image requirement.
- Primary flow: three equal-width cards with explicit arrows.
- Reading order: title, use cases, transfer flow, content policy.
- Important content stays inside the central area so a 2:1 social crop remains usable.
- Text remains readable at README width; the PNG is not intended for very small icon use.

## Accessibility text

Use this alt text for either asset:

```text
A source coding-agent session is normalized, filtered, previewed, and written as a new native session while the source remains unchanged.
```

The SVG also includes a `<title>` and `<desc>` with the same meaning.

## Render the PNG

The SVG is the source of truth. Regenerate the PNG with librsvg:

```sh
rsvg-convert --width 1600 --height 1000 \
  assets/resume-from-card.svg > assets/resume-from-card.png
```

Verify the result:

```sh
identify -format '%wx%h %b\n' assets/resume-from-card.png
```

Expected dimensions are `1600x1000`.

## Pi package gallery

The `pi.image` field in `package.json` points to the PNG:

```text
https://raw.githubusercontent.com/alexei-led/resume-from/fa0bfa778b52c64accc53155f12f3b895476ea08/assets/resume-from-card.png
```

The URL is pinned to a commit so the published package image remains stable. Update `pi.image` when the asset changes.

## GitHub social preview

Use the PNG as the source. Crop it to `1280 × 640` in the repository settings. Keep all three transfer cards visible; trim vertical space before trimming either side.
