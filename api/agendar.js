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
        end: { dateTime: endIso, timeZone: 'America/Sao_Paulo' }
      };

      const createdEvent = await calendar.events.insert({ calendarId, resource: event, sendUpdates: 'none' });

      return res.status(200).json({ success: true, eventId: createdEvent.data.id, meetLink: meetLinkCustom });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error('Erro na API:', error);
    return res.status(500).json({ error: 'Erro interno no servidor de agendamento.', details: error.message });
  }
}
