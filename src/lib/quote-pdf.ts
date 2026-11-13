import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type QuotePdfDetails = {
  reference: string;
  createdAt: Date;
  acceptedAt?: Date;
  validUntil?: Date;
  client: { name: string; email: string; phone: string };
  artisan: { name: string; email: string; phone: string; category: string; city: string };
  category: string;
  description: string;
  address: string;
  latitude?: number;
  longitude?: number;
  scheduledAt: Date;
  accessDetails: string;
  items: { description: string; amount: number }[];
  total: number;
};

const pageWidth = 595.28;
const pageHeight = 841.89;
const left = 52;
const contentWidth = pageWidth - left * 2;
const green = rgb(0.12, 0.34, 0.25);
const muted = rgb(0.38, 0.43, 0.4);

function printable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, " ");
}

function formatDate(value: Date): string {
  return printable(new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(value));
}

export async function generateQuotePdf(details: QuotePdfDetails): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.setTitle(`Devis QuickFix ${details.reference}`);
  document.setSubject("Devis d'intervention valide par le client");
  document.setCreator("QuickFix");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 54;

  const drawPageHeader = () => {
    y = pageHeight - 54;
    page.drawText("QUICKFIX  |  DEVIS D'INTERVENTION", {
      x: left,
      y,
      size: 9,
      font: bold,
      color: green,
    });
    y -= 28;
  };

  const newPage = () => {
    page = document.addPage([pageWidth, pageHeight]);
    drawPageHeader();
  };

  const ensureSpace = (height: number) => {
    if (y - height < 48) newPage();
  };

  const drawWrapped = (value: string, font: PDFFont, size: number, color = muted) => {
    const words = printable(value).split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > contentWidth) {
        ensureSpace(size + 6);
        page.drawText(line, { x: left, y, size, font, color });
        y -= size + 6;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      ensureSpace(size + 6);
      page.drawText(line, { x: left, y, size, font, color });
      y -= size + 6;
    }
  };

  const heading = (value: string) => {
    ensureSpace(28);
    y -= 8;
    page.drawText(printable(value.toUpperCase()), { x: left, y, size: 10, font: bold, color: green });
    y -= 18;
  };

  drawPageHeader();
  page.drawText("Devis d'intervention", { x: left, y, size: 22, font: bold, color: green });
  y -= 24;
  drawWrapped(`Reference : ${details.reference}`, regular, 10);
  drawWrapped(`Emis le ${formatDate(details.createdAt)} - Valide jusqu'au ${details.validUntil ? formatDate(details.validUntil) : "date non precisee"}`, regular, 10);
  drawWrapped(
    details.acceptedAt
      ? `Devis valide par le client le ${formatDate(details.acceptedAt)}`
      : "Statut : devis non valide par le client",
    bold,
    10,
    green,
  );

  heading("Client");
  drawWrapped(details.client.name, bold, 11);
  drawWrapped(`Courriel : ${details.client.email || "Non renseigne"}`, regular, 10);
  drawWrapped(`Telephone : ${details.client.phone || "Non renseigne"}`, regular, 10);

  heading("Artisan");
  drawWrapped(details.artisan.name, bold, 11);
  drawWrapped(`Courriel : ${details.artisan.email || "Non renseigne"}`, regular, 10);
  drawWrapped(`Telephone : ${details.artisan.phone || "Non renseigne"}`, regular, 10);
  drawWrapped(`Specialite : ${details.artisan.category || details.category}`, regular, 10);
  drawWrapped(`Ville : ${details.artisan.city || "Non renseignee"}`, regular, 10);

  heading("Intervention a realiser");
  drawWrapped(`Categorie : ${details.category}`, bold, 10);
  drawWrapped(`Description : ${details.description}`, regular, 10);
  drawWrapped(`Date prevue : ${formatDate(details.scheduledAt)}`, regular, 10);
  drawWrapped(`Adresse : ${details.address}`, regular, 10);
  if (details.latitude !== undefined && details.longitude !== undefined) {
    drawWrapped(`Coordonnees GPS : ${details.latitude}, ${details.longitude}`, regular, 10);
  }
  if (details.accessDetails) drawWrapped(`Acces : ${details.accessDetails}`, regular, 10);

  heading("Detail du devis");
  for (const item of details.items) {
    drawWrapped(`${item.description} - ${item.amount.toFixed(2)} DT`, regular, 10);
  }
  ensureSpace(32);
  y -= 4;
  page.drawLine({ start: { x: left, y }, end: { x: pageWidth - left, y }, thickness: 1, color: green });
  y -= 22;
  page.drawText(`TOTAL : ${details.total.toFixed(2)} DT`, {
    x: left,
    y,
    size: 13,
    font: bold,
    color: green,
  });

  return Buffer.from(await document.save());
}
