import { google } from 'googleapis';

export default async function handler(req, res) {
  // Configuração de CORS
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
    const calendarId = 'primary';

    const BASE_URL_SALA = 'https://agendamento-cupomclic.vercel.app/sala.html';

    // ----------------------------------------------------
    // METODO GET: Consulta os agendamentos (Formulário + Admin)
    // ----------------------------------------------------
    if (req.method === 'GET') {
      const { data } = req.query;

      if (!data) {
        return res.status(400).json({ error: 'Data não informada.' });
      }

      // Intervalo exato do dia no fuso de São Paulo
      const timeMin = `${data}T00:00:00-03:00`;
      const timeMax = `${data}T23:59:59-03:00`;

      const response = await calendar.events.list({
        calendarId: calendarId,
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];

      // Mapeia os horários para anular os botões no formulário
      const ocupados = [];
      const detalhes = [];

      for (const event of events) {
        let horaStr = '';

        // Extrai a hora exata enviada (formato HH:MM)
        if (event.start && event.start.dateTime) {
          const match = event.start.dateTime.match(/T(\d{2}:\d{2})/);
          if (match) {
            horaStr = match[1];
            ocupados.push(horaStr);
          }
        }

        // Se for um evento válido de horário
        if (horaStr) {
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
    // METODO POST: Criação do Agendamento pelo Formulário
    // ----------------------------------------------------
    if (req.method === 'POST') {
      const { data, hora, nome, email, funcao, loja, whatsapp } = req.body;

      if (!data || !hora || !nome || !loja || !whatsapp) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
      }

      // Monta data/hora em ISO com fuso fixo de Brasília (-03:00)
      const startDateTime = `${data}T${hora}:00-03:00`;
      
      const [h, m] = hora.split(':').map(Number);
      let endH = h;
      let endM = m + 30;
      if (endM >= 60) {
        endH += 1;
        endM -= 60;
      }
      const endHStr = String(endH).padStart(2, '0');
      const endMStr = String(endM).padStart(2, '0');
      const endDateTime = `${data}T${endHStr}:${endMStr}:00-03:00`;

      const hashAleatorio = Math.random().toString(36).substring(2, 8);
      const meetLinkCustom = `${BASE_URL_SALA}?id=cupom-${data.replace(/-/g, '')}-${hashAleatorio}`;

      const event = {
        summary: `Reunião VIP CupomClic - ${loja} (${nome})`,
        description: `Agendamento via Site CupomClic\n\nNome: ${nome}\nE-mail: ${email}\nFunção: ${funcao}\nLoja: ${loja}\nWhatsApp: ${whatsapp}\n\nLink da Sala: ${meetLinkCustom}`,
        start: {
          dateTime: startDateTime,
          timeZone: 'America/Sao_Paulo'
        },
        end: {
          dateTime: endDateTime,
          timeZone: 'America/Sao_Paulo'
        }
      };

      const createdEvent = await calendar.events.insert({
        calendarId: calendarId,
        resource: event
      });

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
