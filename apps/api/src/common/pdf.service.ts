import { Injectable } from '@nestjs/common';
import { formatDateTime } from '@cc/shared';
import PdfPrinter from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { SettingsService } from './settings.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfs = require('pdfmake/build/vfs_fonts.js') as Record<string, string>;
const font = (name: string) => Buffer.from(vfs[name], 'base64');

/** Server-side PDFs (reports now, receipts in Accounts). Roboto covers English text and the ₹ sign. */
@Injectable()
export class PdfService {
  private printer = new PdfPrinter({
    Roboto: { normal: font('Roboto-Regular.ttf'), bold: font('Roboto-Medium.ttf'), italics: font('Roboto-Italic.ttf'), bolditalics: font('Roboto-MediumItalic.ttf') },
  });
  constructor(private settings: SettingsService) {}

  /** A branded A4 document: header with the institute name, title block, body, page numbers. */
  async render(o: { title: string; subtitle?: string; meta?: [string, string][]; body: Content[] }): Promise<Buffer> {
    const brand = await this.settings.get('brand.name');
    const doc: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [40, 60, 40, 50],
      defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1b2a30' },
      info: { title: o.title, creator: brand },
      header: { text: brand, margin: [40, 24, 40, 0], fontSize: 9, color: '#0E3B47', bold: true },
      footer: (page, pages) => ({ columns: [{ text: `Generated ${formatDateTime(new Date())} IST`, color: '#6b7a80' }, { text: `Page ${page} of ${pages}`, alignment: 'right', color: '#6b7a80' }], margin: [40, 0, 40, 0], fontSize: 8 }),
      content: [
        { text: o.title, fontSize: 18, bold: true, color: '#0E3B47', margin: [0, 0, 0, 2] },
        ...(o.subtitle ? [{ text: o.subtitle, color: '#6b7a80', margin: [0, 0, 0, 10] } as Content] : []),
        ...(o.meta?.length ? [{
          table: { widths: [110, '*'], body: o.meta.map(([k, v]) => [{ text: k, color: '#6b7a80' }, { text: v, bold: true }]) },
          layout: 'noBorders', margin: [0, 0, 0, 12],
        } as Content] : []),
        ...o.body,
      ],
      styles: {
        h2: { fontSize: 12, bold: true, color: '#0E3B47', margin: [0, 12, 0, 6] },
        th: { bold: true, color: '#ffffff', fillColor: '#0E3B47' },
        muted: { color: '#6b7a80' },
      },
    };
    return new Promise((resolve, reject) => {
      const pdf = this.printer.createPdfKitDocument(doc);
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.end();
    });
  }

  /** A simple zebra table with a dark header row. */
  table(headers: string[], rows: (string | number)[][], widths?: (string | number)[]): Content {
    return {
      table: {
        headerRows: 1,
        widths: widths ?? headers.map(() => '*'),
        body: [headers.map((h) => ({ text: h, style: 'th' })), ...rows.map((r) => r.map((c) => String(c)))],
      },
      layout: { fillColor: (i: number) => (i > 0 && i % 2 === 0 ? '#f2f6f7' : null), hLineColor: () => '#d9e2e5', vLineColor: () => '#d9e2e5' },
    };
  }
}
