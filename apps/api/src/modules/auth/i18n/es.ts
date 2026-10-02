/** Texts of the account e-mails (Spanish). Subjects never carry names: they show up in lock screens and logs. */
export const authMailEs = {
  footerAutomatic: 'Este es un mensaje automático de ProcesaBPM.',
  passwordReset: {
    subject: 'Restablece tu contraseña de ProcesaBPM',
    title: 'Restablece tu contraseña',
    greeting: (firstName: string) => `Hola ${firstName},`,
    request: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta.',
    validity: (minutes: number) => `El enlace sirve una sola vez y vence en ${minutes} minutos.`,
    action: 'Restablecer contraseña',
    ignore: 'Si no lo solicitaste, ignora este mensaje: tu contraseña no cambiará.',
  },
  invitation: {
    subject: 'Te invitaron a ProcesaBPM',
    title: 'Te invitaron a ProcesaBPM',
    greeting: (firstName: string) => `Hola ${firstName},`,
    invited: (organization: string) => `Te invitaron a unirte a la organización «${organization}».`,
    validity: (days: number) => `El enlace sirve una sola vez y vence en ${days} días.`,
    action: 'Aceptar la invitación',
    ignore: 'Si no esperabas esta invitación, ignora este mensaje.',
  },
} as const;
