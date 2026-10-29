# Rebotes y quejas de correo (Amazon SES → SNS)

Cuando un correo **rebota de forma permanente** (la dirección no existe) o el destinatario lo **marca como spam** (queja),
Amazon SES lo avisa. Si la plataforma sigue escribiendo a esas direcciones, SES baja la reputación de la cuenta y puede
pausar el envío de **todos** los correos. Por eso:

1. SES publica cada rebote y cada queja en un **tema de SNS**.
2. SNS los envía por HTTPS a la plataforma: `POST https://app.procesabpm.com/api/public/email-events/ses`.
3. La plataforma verifica que el mensaje sea de verdad de SNS y de **nuestro** tema: la firma (versión 1 o 2), que el
   certificado venga de `sns.<región>.amazonaws.com` y que el mensaje sea reciente. Si lo es, guarda la dirección en
   **«Correos bloqueados»**.
4. Desde ese momento, el worker **no le escribe** a esa dirección: el correo se da por atendido y se anota en el log como
   `mail.suppressed`, sin la dirección.
5. En la consola de plataforma, **«Correos bloqueados»** lista las direcciones y permite quitar una. Quitarla queda en la
   auditoría.

Los rebotes temporales (buzón lleno, servidor ocupado) no bloquean nada: SES los reintenta solo.

## Lo que creas en AWS (una sola vez)

Todo en la **misma región** de SES (por ejemplo `us-east-1`).

### 1. El tema de SNS

**SNS → Topics → Create topic**:

- **Type:** *Standard*.
- **Name:** `procesabpm-ses-events`.
- **Access policy:** deja la predeterminada y agrega este permiso para que SES pueda publicar. Cambia `CUENTA` por tu número
  de cuenta de 12 dígitos y `REGION` por la región:

  ```json
  {
    "Sid": "AllowSesPublish",
    "Effect": "Allow",
    "Principal": { "Service": "ses.amazonaws.com" },
    "Action": "SNS:Publish",
    "Resource": "arn:aws:sns:REGION:CUENTA:procesabpm-ses-events",
    "Condition": { "StringEquals": { "AWS:SourceAccount": "CUENTA" } }
  }
  ```

Copia el **ARN del tema**: `arn:aws:sns:REGION:CUENTA:procesabpm-ses-events`.

### 2. Decirle a la plataforma cuál es el tema

En el `.env` del servidor:

```
SES_SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:procesabpm-ses-events
```

Reinicia el API (`docker compose … up -d api`). Sin esta variable, el endpoint responde 404 y no acepta nada. La plataforma
solo acepta mensajes de **ese** tema: un mensaje de otro tema o con una firma mala se rechaza con 403.

### 3. La suscripción HTTPS

En el tema: **Create subscription**:

- **Protocol:** *HTTPS*.
- **Endpoint:** `https://app.procesabpm.com/api/public/email-events/ses`.
- **Enable raw message delivery:** **desactivado**. La plataforma necesita el sobre de SNS con su firma.

Al crearla, SNS manda un mensaje de confirmación y la plataforma lo **confirma sola** (`ses.sns_subscription_confirmed` en
el log). En la consola de SNS la suscripción debe pasar de *Pending confirmation* a *Confirmed* en unos segundos. Si se
queda en *Pending*, revisa que el paso 2 esté hecho y que el API se haya reiniciado.

### 4. Que SES publique en el tema

**SES → Identities → `procesabpm.com` → Notifications → Feedback notifications → Edit**:

- **Bounce feedback:** el tema `procesabpm-ses-events`.
- **Complaint feedback:** el mismo tema.
- **Include original email headers:** desactivado. No hace falta y lleva más datos.

Cuando los avisos ya llegan por SNS, en la misma pantalla puedes desactivar el **reenvío por correo** de rebotes y quejas
(*Email feedback forwarding*), para no recibirlos también en el buzón del remitente.

Si prefieres usar un **configuration set** de SES en lugar de las notificaciones de la identidad, crea un *event
destination* de tipo SNS con los eventos *Bounces* y *Complaints* hacia el mismo tema. La plataforma lee los dos formatos.

### 5. Probar

SES tiene direcciones de prueba que simulan cada caso sin afectar la reputación. Desde **SES → Identities →
`procesabpm.com` → Send test email**, envía un correo a:

- `bounce@simulator.amazonses.com`: es un rebote permanente;
- `complaint@simulator.amazonses.com`: es una queja.

En un minuto, las dos direcciones deben aparecer en la consola de plataforma, en **«Correos bloqueados»**. Bórralas
después: son de prueba.

## Qué ver si algo falla

En el log del API:

| Evento | Significa |
|---|---|
| `ses.notification` | Llegó un aviso; dice cuántas direcciones traía y cuántas se bloquearon. |
| `ses.sns_refused` con `reason` | Se rechazó un mensaje. `FOREIGN_TOPIC` es otro tema (revisa el ARN del paso 2); `BAD_SIGNATURE` o `BAD_CERT_URL` es un mensaje que no es de SNS; `STALE` es más viejo que una hora. |
| `ses.sns_subscription_confirmed` | La suscripción quedó confirmada. |

En el log del worker, `mail.suppressed` aparece cada vez que no se envía un correo porque la dirección está bloqueada.
