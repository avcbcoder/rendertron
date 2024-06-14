import * as Koa from 'koa';
import * as bodyParser from 'koa-bodyparser';
import * as koaCompress from 'koa-compress';
import * as route from 'koa-route';
import * as koaSend from 'koa-send';
import * as koaLogger from 'koa-logger';
import * as path from 'path';
import * as puppeteer from 'puppeteer';

import {Config, ConfigManager} from './config';

/**
 * Rendertron rendering service. This runs the server which routes rendering
 * requests through to the renderer.
 */
export class Rendertron {
  app: Koa = new Koa();
  private config: Config = ConfigManager.config;
  private port = process.env.PORT;

  async initialize() {
    // Load config
    this.config = await ConfigManager.getConfiguration();

    console.log("PORT IN ENV: ", process.env.PORT);
    // this.port = this.port;

    this.app.use(koaLogger());

    this.app.use(koaCompress());

    this.app.use(bodyParser());

    this.app.use(route.get('/', async (ctx: Koa.Context) => {
      await koaSend(
        ctx, 'index.html', { root: path.resolve(__dirname, '../src') });
    }));
    this.app.use(
      route.get('/_ah/health', (ctx: Koa.Context) => ctx.body = 'OK'));

    // Optionally enable cache for rendering requests.
    if (this.config.datastoreCache) {
      const { DatastoreCache } = await import('./datastore-cache');
      this.app.use(new DatastoreCache().middleware());
    }
    this.app.use(route.get(
        '/search/:ytSearchTerm', this.handleYTSearchRequest.bind(this)));

    return this.app.listen(this.port, () => {
      console.log(`Listening on port ${this.port}`);
    });
  }

  async ytSearch(
    searchTerm: string): Promise<String> {
    const browser = await puppeteer.launch({ args: ['--no-sandbox'], headless: true });
    const page = await browser.newPage();
    await page.goto(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(
        searchTerm
      )}`
    );

    // Wait for the search results to load
    await page.waitForSelector("#video-title");

    // Extract the video ID of the first result
    const videoIdText = await page.evaluate(() => {
      const videoTitleElement = document.querySelector("#video-title");
      if (!videoTitleElement) {
        throw new Error("Could not find video title element");
      }
      const videoTitleElementHref = videoTitleElement.getAttribute("href");
      if (!videoTitleElementHref) {
        throw new Error("Could not find video title href");
      }
      return videoTitleElementHref.split("v=")[1];
    });

    const videoId = videoIdText.split("&")[0];
    console.log(`Video for ${searchTerm} : ${videoId}`);

    // browser.close();
    return videoId;
  }

  async handleYTSearchRequest(ctx: Koa.Context, ytSearchTerm: string) {
    try {
      console.log("searching for : ", ytSearchTerm);
      const ytSearchResult = await this.ytSearch(ytSearchTerm);
      ctx.set('Content-Type', 'text/plain');
      ctx.body = ytSearchResult;
    } catch (error) {
      console.log(error)
    }
  }
}
