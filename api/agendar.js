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

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    let clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      clientEmail = credentials.client_email;
      privateKey = credentials.private_key;
    }

    if (privateKey) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (!clientEmail || !privateKey) {
      return res.status(500).json({ error: 'Credenciais do Google não encontradas na Vercel.' });
    }

    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/calendar']
    );

    const calendar = google.calendar({ version: 'v3', auth });

    const calendarId = '9e28766c113e96cc3f0134d01530e91a8ef4b62cce48da09b950b94306c5007a@group.calendar.google.com';
    const BASE_URL_SALA = 'https://agendamento-cupomclic.vercel.app/sala.html';

    // ----------------------------------------------------
    // METODO GET: Consulta os agendamentos
    // ----------------------------------------------------
    if (req.method === 'GET') {
      const { data } = req.query;

      if (!data) {
        return res.status(400).json({ error: 'Data não informada.' });
      }

      const timeMin = `${data}T00:00:00-03:00`;
      const timeMax = `${data}T23:59:59-03:00`;

      const response = await calendar.events.list({
        calendarId: calendarId,
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: 'America/Sao_Paulo'
      });

      const events = response.data.items || [];
      const ocupados = [];
      const detalhes = [];

      for (const event of events) {
        let horaStr = '';

        if (event.start && event.start.dateTime) {
          const match = event.start.dateTime.match(/T(\d{2}:\d{2})/);
          if (match) {
            horaStr = match[1];
          }
        }

        if (horaStr) {
          ocupados.push(horaStr);

          let meetLink = '';
          if (event.description) {
            const matchLink = event.description.match(/https?:\/\/[^\s]+sala\.html[^\s]*/);
            if (matchLink) meetLink = matchLink[0];
          }

          if (!meetLink) {
            meetLink = `${BASE_URL_SALA}?id=cupom-${data.replace(/-/g, '')}-${event.id.substring(0, 6)}`;
          }

          detalhes.push({
            id: event.id,
            horario: horaStr,
            titulo: event.summary || 'Sem título',
            descricao: event.description || '',
            meetLink: meetLink
          });
        }
      }

      return res.status(200).json({ ocupados, detalhes });
    }

    // ----------------------------------------------------
    // METODO POST: Criação com Trava Anti-Spam / Duplicidade
    // ----------------------------------------------------
    if (req.method === 'POST') {
      const { data, hora, nome, email, funcao, loja, whatsapp } = req.body;

      if (!data || !hora || !nome || !loja || !whatsapp || !email) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
      }

      const emailLimpo = email.trim().toLowerCase();
      const whatsLimpo = whatsapp.replace(/\D/g, '');

      // Valida formato de e-mail ANTES de chamar o Google
      if (!EMAIL_RE.test(emailLimpo)) {
        return res.status(400).json({ error: 'E-mail inválido. Confira e tente novamente.' });
      }
      if (whatsLimpo.length < 10) {
        return res.status(400).json({ error: 'WhatsApp inválido. Use DDD + número.' });
      }
      // 🛑 Bloqueia horário no passado (ou em cima da hora)
      const startCheck = new Date(`${data}T${hora}:00-03:00`).getTime();
      if (startCheck <= Date.now() + 30 * 60000) {
        return res.status(400).json({ error: 'Esse horário já passou. Escolha um horário futuro.' });
      }
      // 🛑 TRAVA DE SEGURANÇA: evita agendamentos duplos
      const agoraIso = new Date().toISOString();
      const futurasResponse = await calendar.events.list({
        calendarId: calendarId,
        timeMin: agoraIso,
        singleEvents: true,
        timeZone: 'America/Sao_Paulo'
      });

      const eventosFuturos = futurasResponse.data.items || [];

      for (const ev of eventosFuturos) {
        const desc = ev.description ? ev.description.toLowerCase() : '';
        const descWhatsLimpo = desc.replace(/\D/g, '');

        const emailEncontrado = desc.includes(emailLimpo);
        const whatsEncontrado = whatsLimpo.length >= 8 && descWhatsLimpo.includes(whatsLimpo);

        if (emailEncontrado || whatsEncontrado) {
          return res.status(400).json({
            error: 'Você já possui uma Reunião VIP agendada! Caso precise alterar o horário, fale com o suporte.'
          });
        }
      }

      const startIso = `${data}T${hora}:00-03:00`;
      const [h, m] = hora.split(':').map(Number);
      let endH = h;
      let endM = m + 30;
      if (endM >= 60) {
        endH += 1;
        endM -= 60;
      }
      const endHStr = String(endH).padStart(2, '0');
      const endMStr = String(endM).padStart(2, '0');
      const endIso = `${data}T${endHStr}:${endMStr}:00-03:00`;

      const hashAleatorio = Math.random().toString(36).substring(2, 8);
      const meetLinkCustom = `${BASE_URL_SALA}?id=cupom-${data.replace(/-/g, '')}-${hashAleatorio}`;

      const event = {
        summary: `Reunião VIP CupomClic - ${loja} (${nome})`,
        description: `Agendamento via Site CupomClic\n\nHorário: ${hora}\nNome: ${nome}\nE-mail: ${emailLimpo}\nFunção: ${funcao}\nLoja: ${loja}\nWhatsApp: ${whatsLimpo}\n\nLink da Sala: ${meetLinkCustom}`,
        start: {
          dateTime: startIso,
          timeZone: 'America/Sao_Paulo',
        },
        end: {
          dateTime: endIso,
          timeZone: 'America/Sao_Paulo',
        },
        attendees: [
          { email: emailLimpo, displayName: nome }
        ]
      };

      // Tenta com convidados (dispara e-mail). Se o Google rejeitar, cria sem convidados.
      let createdEvent;
      try {
        createdEvent = await calendar.events.insert({
          calendarId: calendarId,
          resource: event,
          sendUpdates: 'all'
        });
      } catch (e1) {
        console.error('Insert com attendees falhou, tentando sem attendees:', e1.message);
        delete event.attendees;
        createdEvent = await calendar.events.insert({
          calendarId: calendarId,
          resource: event,
          sendUpdates: 'none'
        });
      }

      return res.status(200).json({
        success: true,
        eventId: createdEvent.data.id,
        meetLink: meetLinkCustom,
      });
    }

    return res.status(405).json({ error: 'Método não permitido.' });

  } catch (error) {
    console.error('Erro na API:', error);
    return res.status(500).json({
      error: 'Erro interno no servidor de agendamento.',
      details: error.message,
    });
  }
}
