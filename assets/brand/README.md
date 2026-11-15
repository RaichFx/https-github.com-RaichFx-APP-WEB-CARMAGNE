# Approved OVLANE app icon exports

`public/brand/ovlane-symbol.svg` is the official SVGZ decompressed without editing its artwork. The source has visible artwork on its artboard and off-artboard content. The favicon and PNGs use only the visible artboard paths, with the original fills and a uniform scale on an opaque white background.

The 180, 192 and 512 px exports place the mark at 64% of the square width, centered, with room for maskable cropping. `npm run build` validates and stages them at the existing application-icon URLs and legacy web-push icon URL. No rendering package or service is required at deploy time.

The horizontal logo remains unchanged. The original colors are retained in both themes; if an official alternate dark-mode variant is supplied, it can be integrated separately.
