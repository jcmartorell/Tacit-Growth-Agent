// Tipografía correcta para textos que se muestran en imágenes y videos:
// acentos en forma compuesta (NFC) y comillas tipográficas en lugar de ' y ",
// que en la fuente se ven como acentos sueltos.
export function typographic(input: string): string {
  return String(input ?? "")
    .normalize("NFC")
    .replace(/(\p{L})'(\p{L})/gu, "$1’$2")              // apóstrofo dentro de palabra: don't → don’t
    .replace(/(^|[\s(\[¿¡—–-])['"‘]/gu, "$1“")          // comilla de apertura
    .replace(/['"‘]/g, "”");                             // cualquier otra: cierre
}
