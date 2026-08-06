# Project image brief

The Pi package gallery finds this project through the `pi-package` keyword in
`package.json`. The gallery can show a PNG, JPEG, GIF, or WebP file from the
`pi.image` field.

The project image is `assets/resume-from-card.png`. Use the prompt below when
you need a new version.

## Image-generation prompt

```text
Create a clean product illustration for an open-source developer tool named
“resume-from”.

Purpose:
The tool moves a coding session between three terminal-based AI coding agents.
It preserves the useful conversation and removes stale tool-result bodies. It
shows a preview, waits for user confirmation, and creates a new native session.
The source session remains unchanged.

Visual concept:
- Show three abstract terminal windows or conversation streams.
- Use distinct, restrained accent colors for the three agents.
- Route one conversation through a small neutral transfer bridge.
- Show a visible preview checkpoint before the destination session.
- Keep the source stream intact on the left.
- Show a clean, active destination stream on the right.
- Use arrows only when they improve the flow.
- Do not use vendor logos, mascots, company marks, or trademarked interface
  elements.
- Do not show people, robots, brains, clouds, locks, shields, or generic AI
  sparkles.
- Do not include paragraphs or small labels.
- If you include text, include only “resume-from” and spell it exactly.

Style:
- Minimal technical editorial illustration.
- Dark neutral background with high contrast.
- Flat geometric shapes with subtle depth.
- Clear at thumbnail size.
- No photorealism and no 3D chrome effect.
- No visual clutter.

Output:
- PNG format.
- 1600 × 1000 pixels, 8:5 aspect ratio.
- Keep important elements inside the central 1600 × 800 area.
- Leave enough empty space for a 2:1 social-preview crop.
- Produce one image without a border or watermark.
```

## Image file

The gallery image is here:

```text
assets/resume-from-card.png
```

Use this alt text:

```text
A coding conversation moves through a preview checkpoint into a new agent
session while the source remains unchanged.
```

## Add the image to Pi

The Pi manifest uses this URL:

```text
https://raw.githubusercontent.com/alexei-led/resume-from/implement-resume-from/assets/resume-from-card.png
```

Open the URL before release. Make sure that it returns the PNG file.

## GitHub social preview

Use the same master image as the source. Crop it to `1280 × 640` for the GitHub
social preview. Add the crop in the GitHub repository settings. GitHub does not
read this image from `package.json`.
