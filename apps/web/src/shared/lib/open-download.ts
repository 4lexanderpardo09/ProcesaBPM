/** Sends the browser to a download link (a presigned URL answered as an attachment, so the page stays). */
export function openDownload(url: string): void {
  window.location.assign(url);
}
