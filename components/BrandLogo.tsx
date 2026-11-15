import React from 'react';

const OVLANE_LOGO = '/brand/ovlane-logo.svg';
const LEGACY_DEFAULTS = new Set(['/logo.png', '/logo-black.png']);
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
  return (
    <span className={custom ? 'ovlane-mark ovlane-mark--custom' : 'ovlane-mark'}>
      <img
        src={custom ? logoUrl : OVLANE_LOGO}
        alt={custom ? 'Logotipo de la empresa' : 'OVLANE'}
        width={Math.round(width)}
        height={Math.round(width * 1150.7 / 3924)}
        style={{ width, aspectRatio: '3924 / 1150.7' }}
        decoding="async"
      />
    </span>
  );
}
