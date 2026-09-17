/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for iOfficeAI/AionUi#4210 — context usage ring clamp.
 *
 * Some ACP backends under-report `used` as a cumulative provider metric
 * (e.g. lifetime input tokens), which used to push the ring far past 100%
 * (up to +900%). The percentage is now clamped to 0-100, so the ring caps
 * at full while warning/danger semantics stay meaningful.
 */

import { render, getByTestId } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

let mockLanguage = 'en-US';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!options) return text;
      return Object.entries(options).reduce((acc, [name, value]) => acc.replaceAll(`{{${name}}}`, String(value)), text);
    },
    i18n: { language: mockLanguage },
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Popover: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
    <>
      {children}
      <div data-testid='popover-content'>{content}</div>
    </>
  ),
}));

import ContextUsageIndicator from '@/renderer/components/agent/ContextUsageIndicator';

describe('ContextUsageIndicator clamp (#4210)', () => {
  it('caps the ring and percentage at 100% when used exceeds the window', () => {
    // The poisoning scenario from the issue: 9.1M cumulative tokens against a
    // 1M window would previously render as ~912%.
    const { container, getByTestId } = render(
      <ContextUsageIndicator tokenUsage={{ total_tokens: 9_119_095 }} context_limit={1_000_000} />
    );

    const popover = getByTestId('popover-content').textContent ?? '';
    expect(popover).toContain('9.1M / 1M');
    const pctText = popover.split('·')[0];
    expect(Number.parseFloat(pctText)).toBeLessThanOrEqual(100);
    expect(Number.parseFloat(pctText)).toBeGreaterThan(99);
  });

  it('keeps warning/danger thresholds meaningful instead of always-danger', () => {
    // With an unclamped +912% the danger color, warning and danger were indistinguishable;
    // clamping keeps pct <= 100 so states stay meaningful.
    // Danger threshold is > 90% of window. A 9.1x over-report still lands
    // inside danger (clamped to 100) rather than NaN / runaway SVG dash
    // offsets.
    const { container } = render(
      <ContextUsageIndicator tokenUsage={{ total_tokens: 9_119_095 }} context_limit={1_000_000} />
    );
    const progressArcs = container.querySelectorAll('circle');
    expect(progressArcs.length).toBe(2);
    const dash = progressArcs[1]?.getAttribute('stroke-dashoffset') ?? '';
    expect(Number.parseFloat(dash)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(dash)).toBeLessThanOrEqual(Number.parseFloat(progressArcs[1]?.getAttribute('stroke-dasharray') ?? '0'));
  });

  it('does not clamp a legitimate sub-100% reading', () => {
    const { getByTestId } = render(
      <ContextUsageIndicator tokenUsage={{ total_tokens: 12_600 }} context_limit={262_144} />
    );
    const popover = getByTestId('popover-content').textContent ?? '';
    expect(popover).toContain('4.8%');
  });
});
