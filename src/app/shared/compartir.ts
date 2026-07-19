/**
 * Comparte un archivo (ej. el PDF de un recibo) usando la Web Share API del
 * dispositivo. En el celular abre el menú nativo (WhatsApp, correo, etc.) con el
 * archivo adjunto. Si el navegador no permite compartir archivos (ej. escritorio)
 * o el usuario no completa el compartir, cae a descargar el archivo.
 *
 * Devuelve 'compartido' si se abrió el menú de compartir (o el usuario lo canceló)
 * y 'descargado' si se usó el respaldo de descarga.
 */
export async function compartirArchivo(
  blob: Blob,
  filename: string,
  titulo: string,
  texto?: string,
): Promise<'compartido' | 'descargado'> {
  const archivo = new File([blob], filename, { type: blob.type || 'application/pdf' });
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };

  if (nav.share && nav.canShare?.({ files: [archivo] })) {
    try {
      await nav.share({ files: [archivo], title: titulo, text: texto });
      return 'compartido';
    } catch (error) {
      // El usuario canceló el menú de compartir: no es un error, no descargamos.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'compartido';
      }
      // Cualquier otro fallo: caemos a la descarga de respaldo.
    }
  }

  descargarBlob(blob, filename);
  return 'descargado';
}

/**
 * Abre WhatsApp (app en el celular o WhatsApp Web en el computador) con un texto
 * ya escrito. Si se pasa un teléfono, abre el chat de ese número; si no, deja que
 * el usuario elija el contacto. Nota: WhatsApp no permite adjuntar archivos por
 * enlace, por eso esto envía solo el resumen en texto (el PDF se manda con
 * `compartirArchivo`, que usa el menú de compartir del dispositivo).
 */
export function compartirWhatsApp(texto: string, telefono?: string | null): void {
  const numero = (telefono ?? '').replace(/\D/g, '');
  const base = numero ? `https://wa.me/${numero}` : 'https://wa.me/';
  window.open(`${base}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
}

/** Descarga un Blob disparando el guardado en el navegador. */
export function descargarBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
