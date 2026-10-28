import React from "react";

/** Marca do app (mesmo desenho de ui/assets/icon.svg): o grafo do Flow, páginas que convergem no destino em amarelo, sobre
    o roxo noite. */
export const MarcaIcone: React.FC = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="marca-fundo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3B2A80" /><stop offset="1" stopColor="#160E3A" /></linearGradient>
      <radialGradient id="marca-brilho" cx="0.25" cy="0.15" r="0.75"><stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" /><stop offset="1" stopColor="#FFFFFF" stopOpacity="0" /></radialGradient>
    </defs>
    <rect width="64" height="64" rx="15" fill="url(#marca-fundo)" />
    <rect width="64" height="64" rx="15" fill="url(#marca-brilho)" />
    <g fill="none" stroke="#E9E3FF" strokeWidth="2.8" strokeLinecap="round">
      <path d="M14 32 C 22 32, 22 18, 31 18" /><path d="M14 32 H 31" /><path d="M14 32 C 22 32, 22 46, 31 46" />
      <path d="M33 18 C 42 18, 42 32, 49 32" /><path d="M33 32 H 49" /><path d="M33 46 C 42 46, 42 32, 49 32" />
    </g>
    <circle cx="14" cy="32" r="5.4" fill="#E9E3FF" />
    <circle cx="32" cy="18" r="3.8" fill="#E9E3FF" /><circle cx="32" cy="32" r="3.8" fill="#E9E3FF" /><circle cx="32" cy="46" r="3.8" fill="#E9E3FF" />
    <circle cx="50" cy="32" r="8.2" fill="#FFC83D" opacity="0.35" /><circle cx="50" cy="32" r="5.8" fill="#FFC83D" />
  </svg>
);
