import React from 'react';

const OVLANE_LOGO = '/brand/ovlane-logo.svg?v=2';
const LEGACY_DEFAULTS = new Set(['/logo.png', '/logo-black.png']);
const OVLANE_ASPECT_RATIO = 4017.1 / 1315.6;
const CUSTOM_ASPECT_RATIO = 3924 / 1150.7;
const WIDTHS = { access: 244, sidebar: 164, compact: 116 } as const;

interface BrandLogoProps {
  size?: keyof typeof WIDTHS;
  logoUrl?: string;
  scale?: number;
}

export function BrandLogo({ size = 'sidebar', logoUrl, scale = 1 }: BrandLogoProps) {
  // Configured company marks are independent from the default platform brand.
  const custom = Boolean(logoUrl && !LEGACY_DEFAULTS.has(logoUrl));
  const width = WIDTHS[size] * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  const aspectRatio = custom ? CUSTOM_ASPECT_RATIO : OVLANE_ASPECT_RATIO;
  return (
    <span className={custom ? 'ovlane-mark ovlane-mark--custom' : 'ovlane-mark'}>
      <img
        src={custom ? logoUrl : OVLANE_LOGO}
        alt={custom ? 'Logotipo de la empresa' : 'OVLANE'}
        width={Math.round(width)}
        height={Math.round(width / aspectRatio)}
        style={{ width, aspectRatio }}
        decoding="async"
      />
    </span>
  );
}
