import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { selectAllInEditor, typeInEditor } from '@/test/rich-text-editor';
import { isBlankRichText, RichTextEditor, type RichTextEditorHandle } from './RichTextEditor';

function Controlled({ initial = '', handle }: { readonly initial?: string; readonly handle?: React.Ref<RichTextEditorHandle> }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RichTextEditor label="Comentario" placeholder="Escribe aquí" value={value} onValueChange={setValue} ref={handle} />
      <output data-testid="html">{value}</output>
      <button type="button" onClick={() => setValue('')}>
        Vaciar
      </button>
    </>
  );
}

const html = () => screen.getByTestId('html').textContent;

describe('RichTextEditor', () => {
  it('is a textbox named by its label that reports what is typed as HTML', async () => {
    render(<Controlled />);
    const editor = screen.getByRole('textbox', { name: 'Comentario' });
    expect(screen.getByText('Escribe aquí')).toBeInTheDocument();
    typeInEditor(editor, 'Hola equipo');
    expect(html()).toBe('<p>Hola equipo</p>');
    expect(screen.queryByText('Escribe aquí')).not.toBeInTheDocument();
  });

  it('formats the selection from the toolbar and shows the button pressed', async () => {
    render(<Controlled initial="<p>importante</p>" />);
    const editor = screen.getByRole('textbox', { name: 'Comentario' });
    selectAllInEditor(editor);
    await userEvent.click(screen.getByRole('button', { name: 'Negrita' }));
    expect(html()).toBe('<p><strong>importante</strong></p>');
    expect(screen.getByRole('button', { name: 'Negrita' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('inserts a table and offers its row and column buttons inside it', async () => {
    render(<Controlled />);
    typeInEditor(screen.getByRole('textbox', { name: 'Comentario' }), 'Datos:');
    await userEvent.click(screen.getByRole('button', { name: 'Insertar tabla' }));
    expect(html()).toContain('<table');
    expect(html()?.match(/<tr>/g)).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: '+ Fila' }));
    expect(html()?.match(/<tr>/g)).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar tabla' }));
    expect(html()).not.toContain('<table');
  });

  it('colors the text with the chosen swatch', async () => {
    render(<Controlled initial="<p>alerta</p>" />);
    selectAllInEditor(screen.getByRole('textbox', { name: 'Comentario' }));
    await userEvent.click(screen.getByRole('button', { name: 'Color del texto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rojo' }));
    expect(html()).toBe('<p><span style="color: rgb(198, 40, 40);">alerta</span></p>');
  });

  it('links the selection to a web address and refuses other schemes', async () => {
    render(<Controlled initial="<p>manual</p>" />);
    selectAllInEditor(screen.getByRole('textbox', { name: 'Comentario' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enlace' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Dirección del enlace' }), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByText(/Escribe una dirección web/)).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Dirección del enlace' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Dirección del enlace' }), 'example.com/guia');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(html()).toContain('href="https://example.com/guia"');
  });

  it('takes a value set from outside and inserts HTML through its handle', async () => {
    const handle = createRef<RichTextEditorHandle>();
    render(<Controlled initial="<p>borrador</p>" handle={handle} />);
    await userEvent.click(screen.getByRole('button', { name: 'Vaciar' }));
    expect(screen.getByRole('textbox', { name: 'Comentario' })).toHaveTextContent('');
    act(() => handle.current?.insertHtml('<p>Plantilla <em>lista</em></p>'));
    expect(html()).toBe('<p>Plantilla <em>lista</em></p>');
  });

  it('says when the text is longer than the API takes and marks itself invalid', () => {
    render(<RichTextEditor label="Comentario" value={`<p>${'a'.repeat(30)}</p>`} maxLength={20} onValueChange={() => undefined} />);
    const editor = screen.getByRole('textbox', { name: 'Comentario' });
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(editor).toHaveAccessibleDescription(/demasiado largo/);
  });
});

describe('isBlankRichText', () => {
  it('is blank without text, and not with a table or a line', () => {
    expect(isBlankRichText('')).toBe(true);
    expect(isBlankRichText('<p> </p><p></p>')).toBe(true);
    expect(isBlankRichText('<p>ok</p>')).toBe(false);
    expect(isBlankRichText('<table><tbody><tr><td></td></tr></tbody></table>')).toBe(false);
  });
});
