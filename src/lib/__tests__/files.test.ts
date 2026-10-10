import { describe, expect, it } from "vitest";
import { cleanFileName, formatBytes, sniffMime } from "@/lib/clinical/files";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("sniffMime", () => {
  it("reconhece PDF, PNG, JPEG e WEBP pelos primeiros bytes", () => {
    expect(sniffMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf");
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffMime(webp)).toBe("image/webp");
  });

  it("recusa executável, HTML e SVG disfarçados", () => {
    expect(sniffMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniffMime(bytes(0x4d, 0x5a))).toBeNull(); // MZ (exe)
    expect(sniffMime(new Uint8Array([]))).toBeNull();
  });
});

describe("cleanFileName / formatBytes", () => {
  it("remove caminho e controles", () => {
    expect(cleanFileName("C:\\Users\\x\\exame.pdf")).toBe("exame.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("a\nb.pdf")).toBe("ab.pdf");
    expect(cleanFileName("   ")).toBe("arquivo");
    expect(cleanFileName("x".repeat(500)).length).toBe(200);
  });

  it("formata tamanhos", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
