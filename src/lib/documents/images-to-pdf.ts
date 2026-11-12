/** PDF פשוט מתמונות JPEG שכבר צולמו. בלי דחיסה מחדש. */

export type JpegPdfPage = {
  jpeg: Uint8Array;
  width: number;
  height: number;
};

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const encoder = new TextEncoder();

function text(value: string): Uint8Array {
  return encoder.encode(value);
}

export function buildJpegPdf(pages: JpegPdfPage[]): Uint8Array {
  if (pages.length === 0) throw new Error("אין עמודים למסמך");
  for (const page of pages) {
    if (page.width < 1 || page.height < 1) throw new Error("גודל עמוד לא תקין");
    if (page.jpeg.length < 4 || page.jpeg[0] !== 0xff || page.jpeg[1] !== 0xd8) {
      throw new Error("עמוד PDF חייב להיות JPEG");
    }
  }

  const objects: Uint8Array[] = [];
  const pageObjectIds: number[] = [];
  let nextId = 3;
  for (const page of pages) {
    const imageId = nextId++;
    const contentId = nextId++;
    const pageId = nextId++;
    pageObjectIds.push(pageId);
    const content = `q\n${page.width} 0 0 ${page.height} 0 0 cm\n/Im0 Do\nQ\n`;
    objects.push(
      text(
        `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      ),
    );
    objects.push(page.jpeg);
    objects.push(text(`\nendstream\nendobj\n`));
    objects.push(
      text(
        `${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
      ),
    );
    objects.push(
      text(
        `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
      ),
    );
  }

  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  const header = text("%PDF-1.4\n");
  const catalog = text("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const pageTree = text(
    `2 0 obj\n<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`,
  );
  const body = concat([header, catalog, pageTree, ...objects]);
  const offsets: number[] = [];
  let cursor = header.length;
  offsets[1] = cursor;
  cursor += catalog.length;
  offsets[2] = cursor;
  cursor += pageTree.length;
  let objectIndex = 3;
  for (let i = 0; i < pages.length; i += 1) {
    const imageHeader = objects[i * 5];
    const jpeg = objects[i * 5 + 1];
    const imageTail = objects[i * 5 + 2];
    const content = objects[i * 5 + 3];
    const page = objects[i * 5 + 4];
    offsets[objectIndex] = cursor;
    cursor += imageHeader.length + jpeg.length + imageTail.length;
    objectIndex += 1;
    offsets[objectIndex] = cursor;
    cursor += content.length;
    objectIndex += 1;
    offsets[objectIndex] = cursor;
    cursor += page.length;
    objectIndex += 1;
  }

  const size = objectIndex;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF`;
  return concat([body, text(xref)]);
}
