// Public GitHub contributors snapshot, checked 2026-10-20.
// Source: https://api.github.com/repos/czaydev/better-payment/contributors
// Update from that endpoint; keep the page independent of API availability.
// Bots and AI assistant accounts (e.g. claude, dependabot, *[bot]) are left out.
// `owner` marks the code owners listed in .github/CODEOWNERS.
// Enard52 is listed for merged work on `beta` (#258) plus the open PR queue;
// the API endpoint above only reflects `main`, where those commits land on release.
export const contributors: { login: string; avatarId: number; owner?: boolean }[] = [
  { login: "czaydev", avatarId: 48617418, owner: true },
  { login: "poyrazavsever", avatarId: 78071274, owner: true },
  { login: "ius-sharma", avatarId: 176735086 },
  { login: "sizinajans", avatarId: 183029633 },
  { login: "ScottHallchico", avatarId: 110402749 },
  { login: "Enard52", avatarId: 223665159 },
];
