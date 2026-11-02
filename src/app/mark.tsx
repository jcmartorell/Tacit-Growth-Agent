// Símbolo de Tacit dibujado en SVG (fondo transparente)
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <g stroke="var(--pulse)" strokeWidth="22" strokeLinecap="round" fill="none">
        <line x1="40" y1="92" x2="166" y2="92" />
        <line x1="346" y1="92" x2="472" y2="92" />
        <line x1="104" y1="92" x2="256" y2="244" />
        <line x1="408" y1="92" x2="256" y2="244" />
        <line x1="256" y1="244" x2="256" y2="432" />
      </g>
    </svg>
  );
}
