require('date-utils');
const fs = require('fs');
const fetch = require('node-fetch');
const csvSync = require('csv-parse/lib/sync');
const express = require('express');
const {URLSearchParams} = require('url');

const config = require('./server-config.json');

const NEWS_SAVE_FILE = __dirname + '/data/news.txt';
const AREA_JSON_FILE = __dirname + '/data/area.json';
const areas = JSON.parse(fs.readFileSync(AREA_JSON_FILE, 'utf-8'));
const PORT =process.env.PORT ;

const app = express();
app.use(express.static(__dirname + '/public'));
app.listen(PORT, () => {
  console.log(`Server started on port:${config.PORT}`);
});

app.get('/chat', async function (req, res) {
  const text = req.query.text || '';

  const reply = await dispatch(text);
  console.log(reply);
  res.json(reply);
});

async function dispatch(text) {
  const weatherPattern = new RegExp('(.*[^の])?(の)?(天気)');
  const newsPattern = new RegExp('ニュース');
  const covid19Pattern = new RegExp('感染者|陽性者|コロナ');

  let reply = null;

  const keyMatch = text.match(weatherPattern);
  if (keyMatch) {
    reply = await askForWeather(keyMatch[1]);
  } else if (text.match(newsPattern)) {
    reply = await askForNews(text);
  } else if (text.match(covid19Pattern)) {
    reply = await askForCovid19();
  } else {
    reply = await smallTalk(text);
  }

  if (reply) {
    reply.score = await analyzeSentiment(text);
  } else {
    reply = createReply('すみません、わかりません');
  }
  return reply;
}

function createReply(text, linkUrl = null, imageUrl = null, score = -1.0) {
  return {
    text,
    linkUrl,
    imageUrl,
    score,
  };
}

async function askForWeather(areaName) {
  const { code, name } = textToAreaCode(areaName);

  try {
    const response = await fetch(config.WEATHER_URL + code + '.json');
    if (!response.ok) {
      return null;
    }
    const json = await response.json();

    const latest = json[0].timeSeries[0].areas[0];
    const reply = createReply(`${name}の天気は　${latest.weathers[1]}　でしょう`);
    return reply;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function textToAreaCode(text) {
  if (!text) {
    return config.WEATHER_DEFAULT_AREA;
  }
  for (const [code, value] of Object.entries(areas.offices)) {
    const name = value.name;
    const regexp = new RegExp(text);
    if (name.match(regexp)) {
      return {name, code};
    }
  }
  return config.WEATHER_DEFAULT_AREA;
}

async function askForNews() {

  const qs = new URLSearchParams({
    apiKey: config.NEWS_API_KEY,
    country: config.NEWS_API_COUNTRY,
  });

  try {
    const response = await fetch(`${config.NEWS_API_URL}?${qs}`);
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    const unreadArticles = filterUnreadArticles(json.articles);
    if (unreadArticles.length === 0) {
      return createReply('ニュースがありません');
    }

    const latestArticle = unreadArticles[0];
    fs.appendFileSync(NEWS_SAVE_FILE, latestArticle.url + '\n');

    const publishedDate = (new Date(latestArticle.publishedAt)).toFormat('M月D日HH24時MI分')
    return createReply(
      `${publishedDate}のニュースです。${latestArticle.title}`,
      latestArticle.url,
      latestArticle.urlToImage,
    );
  } catch (error) {
    console.error(error);
    return null;
  }
}

function filterUnreadArticles(articles) {
  return articles.filter(article => {
    let alreadyRead = [];
    if (fs.existsSync(NEWS_SAVE_FILE)) {
      alreadyRead = fs.readFileSync(NEWS_SAVE_FILE).toString().split('\n');
    }
    return !alreadyRead.includes(article.url);
  });
}

async function askForCovid19() {
  try {
    const response = await fetch(config.COVID19_PCR_POSITIVE_DAILY_URL);
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    const csvPcrPositiveDaily = csvSync(text);
    const latest = csvPcrPositiveDaily[csvPcrPositiveDaily.length - 1];

    const date = (new Date(latest[0])).toFormat('M月D日')
    return createReply(`${date}の新型コロナウイルス陽性者数は ${parseInt(latest[1]).toLocaleString()} 人です`)
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function smallTalk(input) {
  const params = new URLSearchParams();
  params.append('apikey', config.TALK_API_KEY);
  params.append('query', input);

  try {
    const response = await fetch(config.TALK_API_URL, {
      method: 'POST',
      body: params,
    });
    if (!response.ok) {
      return null;
    }
    const json = await response.json();

    if (!json?.results || !json?.results[0].reply) {
      return null;
    }
    const reply = {text: json?.results[0].reply, linkUrl: null, imageUrl: null,};
    return reply;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function analyzeSentiment(text) {
  const qs = new URLSearchParams({
    key: config.GOOGLE_SENTIMENT_API_KEY,
  });

  try {
    const response = await fetch(`${config.GOOGLE_SENTIMENT_API_URL}?${qs}`, {
      method: 'POST',
      body: JSON.stringify({
        encodingType: 'UTF8',
        document: {
          type: 'PLAIN_TEXT',
          content: text,
        }

      }),
      headers: {'Content-Type': 'application/json'},
    });
    if (!response.ok) {
      return null;
    }
    const json = await response.json();

    return json.documentSentiment.score;
  } catch (error) {
    console.error(error);
    return null;
  }
}
