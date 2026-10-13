export async function extractResumeText(buffer: Buffer, fileName: string): Promise<string> {
    const isPdf = fileName.toLowerCase().endsWith('.pdf') ||
        buffer.subarray(0, 4).toString('latin1') === '%PDF';

    let text: string;
    if (isPdf) {
        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { text: pages } = await extractText(pdf, { mergePages: true });
        text = Array.isArray(pages) ? pages.join('\n') : pages;
    } else {
        text = buffer.toString('utf8');
    }

    return normalizeWhitespace(text).slice(0, 6000);
}

function normalizeWhitespace(raw: string): string {
    return raw
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}