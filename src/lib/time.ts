// Horas en Ciudad de México. México no usa horario de verano desde 2022: siempre UTC-6.
const OFFSET_HOURS = 6;

// Próximos horarios de publicación: días (0=domingo…6=sábado) a la hora CDMX indicada,
// estrictamente después de "after" (con al menos 2 horas de margen para aprobar).
export function nextSlots(days: number[], hourCdmx: number, after: Date, withinDays = 7): Date[] {
  const minTime = after.getTime() + 2 * 3_600_000;
  const out: Date[] = [];
  // Fecha CDMX de "after"
  const cdmxNow = new Date(after.getTime() - OFFSET_HOURS * 3_600_000);
  for (let d = 0; d <= withinDays; d++) {
    const base = Date.UTC(cdmxNow.getUTCFullYear(), cdmxNow.getUTCMonth(), cdmxNow.getUTCDate() + d);
    const weekday = new Date(base).getUTCDay();
    if (!days.includes(weekday)) continue;
    const slot = new Date(base + (hourCdmx + OFFSET_HOURS) * 3_600_000);
    if (slot.getTime() >= minTime) out.push(slot);
  }
  return out;
}

// ISO (UTC) -> "YYYY-MM-DDTHH:mm" en hora CDMX, para <input type="datetime-local">
export function toCdmxInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - OFFSET_HOURS * 3_600_000);
  return d.toISOString().slice(0, 16);
}

// "YYYY-MM-DDTHH:mm" en hora CDMX -> ISO UTC. Devuelve null si el texto no es válido.
export function fromCdmxInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + OFFSET_HOURS * 3_600_000).toISOString();
}
