/**
 * Shows a PDF the API draws on request (a preview) in a new tab. The tab is opened right away, while the click still
 * counts as the person's (a tab opened after waiting is blocked as a pop-up), and gets the file when it arrives.
 * Returns false when the browser blocked the tab.
 */
export async function openPdf(load: () => Promise<Blob>, opener: Pick<Window, 'open'> = window): Promise<boolean> {
  const tab = opener.open('', '_blank');
  if (tab === null) return false;
  try {
    const url = URL.createObjectURL(await load());
    tab.location.href = url;
    // The tab keeps the document once loaded; the URL itself is not needed after a while.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch (error) {
    tab.close();
    throw error;
  }
}
