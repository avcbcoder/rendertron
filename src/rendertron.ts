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
  private browser: puppeteer.Browser;

  constructor() {
    this.browser = null;
    this.initialize();
  }
  
  async initialize() {
    // Load config
    this.config = await ConfigManager.getConfiguration();

    this.port = this.port || this.config.port;
    console.log("PORT IN ENV: ", process.env.PORT);
    
    this.browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true
    });

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
    this.app.use(route.get('/search/:ytSearchTerm', this.handleYTSearchRequest.bind(this)));


    return this.app.listen(this.port, () => {
      console.log(`Listening on port ${this.port}`);
    });
  }

  async ytSearch(searchTerm: string): Promise<string> {
    try {
      const page = await this.browser.newPage();
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}`, { timeout: 60000 });

      await page.waitForSelector("#video-title", { timeout: 60000 });

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

      await page.close();

      const videoId = videoIdText.split("&")[0];
      console.log(`Video for ${searchTerm} : ${videoId}`);

      return videoId;
    } catch (error) {
      console.error(`Error searching for ${searchTerm}:`, error);
      throw error;
    }
    // finally {
    //   if (this.browser) {
    //     try {
    //       if (this.browser.close)
    //         await this.browser.close();
    //     } catch (closeError) {
    //       console.error("Error closing the browser:", closeError);
    //     }
    //   }
    // }
  }

  async handleYTSearchRequest(ctx: Koa.Context, ytSearchTerm: string) {
    try {
      console.log("searching for : ", ytSearchTerm);
      const ytSearchResult = await this.ytSearch(ytSearchTerm);
      ctx.set('Content-Type', 'text/plain');
      ctx.body = ytSearchResult;
    } catch (error) {
      console.error("Failed to handle YT search request:", error);
      ctx.status = 500;
      ctx.body = 'Internal Server Error';
    }
  }
}

async function logUncaughtError(error: Error) {
  console.error('Uncaught exception');
  console.error(error);
  process.exit(1);
}

// Start rendertron if not running inside tests.
if (!module.parent) {
  // const rendertron =
  new Rendertron();
  // rendertron.initialize();

  process.on('uncaughtException', logUncaughtError);
  process.on('unhandledRejection', logUncaughtError);
}
