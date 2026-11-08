export const iconPaths = {
  chevronDown: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  palette: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1 1 0 0 1 .5-1.8H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5ZM7.5 10h.01M10 6.5h.01M15 6.5h.01M17.5 10h.01',
  sort: 'M4 6h16M7 12h10M10 18h4',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15',
  close: 'm6 6 12 12M6 18 18 6',
  book: 'M6 3h13v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 0v15m-3 0h16',
  warning: 'm12 3 10 18H2L12 3Zm0 5v5m0 4h.01',
} as const;
export type IconName = keyof typeof iconPaths;
