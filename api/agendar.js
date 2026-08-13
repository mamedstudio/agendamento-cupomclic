import { google } from 'googleapis';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    let clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      clientEmail = credentials.client_email;
      privateKey = credentials.private_key;
    }
    if (privateKey) privateKey = privateKey.replace(/\\n/g, '\n');
    if (!clientEmail || !privateKey) {
      return res.status(500).json({ error: 'Credenciais do Google não encontradas na Vercel.' });
    }

    const auth = new google.auth.JWT(clientEmail, null, privateKey, ['https://www.googleapis.com/auth/calendar']);
    const calendar = google.calendar({ version: 'v3', auth });

    const calendarId = '9e28766c113e96cc3f0134d01530e91a8ef4b62cce48da09b950b94306c5007a@group.calendar.google.com';
    const BASE_URL_SALA = 'https://agendamento-cupomclic.vercel.app/sala.html';

    // ============ GET ============
    if (req.method === 'GET') {
      const { data } = req.query;
      if (!data) return res.status(400).json({ error: 'Data não informada.' });

      const response = await calendar.events.list({
        calendarId, timeMin: `${data}T00:00:00-03:00`, timeMax: `${data}T23:59:59-03:00`,
        singleEvents: true, orderBy: 'startTime', timeZone: 'America/Sao_Paulo'
      });

      const events = response.data.items || [];
      const ocupados = [], detalhes = [];
      for (const event of events) {
        let horaStr = '';
        if (event.start && event.start.dateTime) {
          const match = event.start.dateTime.match(/T(\d{2}:\d{2})/);
          if (match) horaStr = match[1];
        }
        if (horaStr) {
          ocupados.push(horaStr);
          let meetLink = '';
          if (event.description) {
            const m = event.description.match(/https?:\/\/[^\s]+sala\.html[^\s]*/);
            if (m) meetLink = m[0];
          }
          if (!meetLink) meetLink = `${BASE_URL_SALA}?id=cupom-${data.replace(/-/g, '')}-${event.id.substring(0, 6)}`;
          detalhes.push({ id: event.id, horario: horaStr, titulo: event.summary || 'Sem título', descricao: event.description || '', meetLink });
        }
      }
      return res.status(200).json({ ocupados, detalhes });
    }

    // ============ POST ============
    if (req.method === 'POST') {
      const { data, hora, nome, email, funcao, loja, whatsapp } = req.body;
      if (!data || !hora || !nome || !loja || !whatsapp || !email) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
      }
      const emailLimpo = email.trim().toLowerCase();
      const whatsLimpo = whatsapp.replace(/\D/g, '');
      if (!EMAIL_RE.test(emailLimpo)) return res.status(400).json({ error: 'E-mail inválido. Confira e tente novamente.' });
      if (whatsLimpo.length < 10) return res.status(400).json({ error: 'WhatsApp inválido. Use DDD + número.' });

      // Bloqueia horário no passado
      const startCheck = new Date(`${data}T${hora}:00-03:00`).getTime();
      if (startCheck <= Date.now() + 30 * 60000) {
        return res.status(400).json({ error: 'Esse horário já passou. Escolha um horário futuro.' });
      }

      // Trava anti-duplicidade
      const futuras = await calendar.events.list({ calendarId, timeMin: new Date().toISOString(), singleEvents: true, timeZone: 'America/Sao_Paulo' });
      for (const ev of (futuras.data.items || [])) {
        const desc = (ev.description || '').toLowerCase();
        if (desc.includes(emailLimpo) || (whatsLimpo.length >= 8 && desc.replace(/\D/g, '').includes(whatsLimpo))) {
          return res.status(400).json({ error: 'Você já possui uma Reunião VIP agendada! Caso precise alterar o horário, fale com o suporte.' });
        }
      }

      const [h, m] = hora.split(':').map(Number);
      let endH = h, endM = m + 30;
      if (endM >= 60) { endH += 1; endM -= 60; }
      const startIso = `${data}T${hora}:00-03:00`;
      const endIso = `${data}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00-03:00`;

      const hash = Math.random().toString(36).substring(2, 8);
      const meetLinkCustom = `${BASE_URL_SALA}?id=cupom-${data.replace(/-/g, '')}-${hash}`;

      const event = {
        summary: `Reunião VIP CupomClic - ${loja} (${nome})`,
        description: `Agendamento via Site CupomClic\n\nHorário: ${hora}\nNome: ${nome}\nE-mail: ${emailLimpo}\nFunção: ${funcao}\nLoja: ${loja}\nWhatsApp: ${whatsLimpo}\n\nLink da Sala: ${meetLinkCustom}`,
        start: { dateTime: startIso, timeZone: 'America/Sao_Paulo' },
        end: { dateTime: endIso, timeZone: 'America/Sao_Paulo' },
        attendees: [{ email: emailLimpo, displayName: nome }]
      };

      let createdEvent;
      try {
        createdEvent = await calendar.events.insert({ calendarId, resource: event, sendUpdates: 'none' });
      } catch (e1) {
        delete event.attendees;
        createdEvent = await calendar.events.insert({ calendarId, resource: event, sendUpdates: 'none' });
      }

      // Envia o e-mail NÓS MESMOS (service account não dispara convite)
      const emailSent = await enviarEmailConfirmacao({ nome, loja, emailLimpo, data, hora, meetLinkCustom });

      return res.status(200).json({ success: true, eventId: createdEvent.data.id, meetLink: meetLinkCustom, emailSent });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error('Erro na API:', error);
    return res.status(500).json({ error: 'Erro interno no servidor de agendamento.', details: error.message });
  }
}

// ============ ENVIO DE E-MAIL (Resend) ============
async function enviarEmailConfirmacao({ nome, loja, emailLimpo, data, hora, meetLinkCustom }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log('RESEND_API_KEY não configurada — e-mail pulado.'); return false; }

  const [a, m, d] = data.split('-');
  const from = process.env.RESEND_FROM || 'CupomClic <onboarding@resend.dev>';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d131f;color:#fff;border-radius:12px;overflow:hidden;">
      <div style="background:#2563eb;padding:20px;text-align:center;font-size:20px;font-weight:bold;">🚀 Reunião VIP CupomClic</div>
      <div style="padding:24px;">
        <p style="font-size:16px;">Olá, <b>${nome}</b>! Sua Reunião VIP está <b style="color:#22c55e;">confirmada</b>.</p>
        <div style="background:#161f30;border:1px solid #243044;border-radius:10px;padding:16px;margin:16px 0;">
          <div style="font-size:13px;color:#94a3b8;">Loja</div><div style="font-weight:bold;">${loja}</div>
          <div style="font-size:13px;color:#94a3b8;margin-top:10px;">Data e hora</div>
          <div style="font-weight:bold;color:#22c55e;">${d}/${m}/${a} às ${hora}h</div>
        </div>
        <a href="${meetLinkCustom}" style="display:block;background:#22c55e;color:#fff;text-align:center;padding:14px;border-radius:10px;font-weight:bold;text-decoration:none;">🚪 Acessar minha sala</a>
        <p style="font-size:13px;color:#94a3b8;margin-top:16px;">💡 Separe <b>1 foto de uma peça</b> — criaremos o cupom juntos, ao vivo. Dura 15–20 min.</p>
      </div>
    </div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [emailLimpo],
        subject: `✅ Confirmado: Reunião VIP CupomClic — ${d}/${m} às ${hora}h`,
        html
      })
    });
    if (!r.ok) { console.error('Resend erro:', await r.text()); return false; }
    return true;
  } catch (e) {
    console.error('Falha ao enviar e-mail:', e.message);
    return false;
  }
}
