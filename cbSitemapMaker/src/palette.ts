import type { ColorKey, ColorValue } from './types'

export const FILL_COLOR_HEX: Record<ColorKey, string> = {
  default: '#ffffff',
  black: '#000000',
  white: '#ffffff',
  red: '#ff3b30',
  yellow: '#ffcc00',
  green: '#00ff40',
  purple: '#a154f2',
}

export const TEXT_COLOR_HEX: Record<ColorKey, string> = {
  default: '#000000',
  black: '#000000',
  white: '#ffffff',
  red: '#ff3b30',
  yellow: '#ffcc00',
  green: '#00ff40',
  purple: '#a154f2',
}

export const HEX_PATTERN = /^#[0-9a-f]{6}$/i

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  }
}

export function resolveColor(value: ColorValue | undefined, kind: 'fill' | 'text'): string {
  if (value === undefined || value === 'default') {
    return kind === 'fill' ? FILL_COLOR_HEX.default : TEXT_COLOR_HEX.default
  }
  if (typeof value === 'string' && HEX_PATTERN.test(value)) {
    return value
  }
  if (value in (kind === 'fill' ? FILL_COLOR_HEX : TEXT_COLOR_HEX)) {
    const key = value as ColorKey
    return kind === 'fill' ? FILL_COLOR_HEX[key] : TEXT_COLOR_HEX[key]
  }
  return kind === 'fill' ? FILL_COLOR_HEX.default : TEXT_COLOR_HEX.default
}