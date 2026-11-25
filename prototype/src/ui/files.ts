/** Legge un file come data URL ridimensionando le immagini (lato lungo max 1600 px) per contenere lo spazio locale. */
export async function leggiFile(f: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
  if (!f.type.startsWith('image/')) return raw;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = raw;
    });
    const scala = Math.min(1, 1600 / Math.max(img.width, img.height));
    if (scala === 1 && raw.length < 1_500_000) return raw;
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scala);
    c.height = Math.round(img.height * scala);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return raw;
  }
}
