import { test, expect } from "./fixtures.mjs";

test("an owner can connect an image and never sees the stored registry token", async ({page,origin}) => {
  let record = null;
  const token = "syntheticFixtureToken123456";
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session") return route.fulfill({json:{
      authenticated:true,user:{id:"owner",email:"owner@example.test"},team:{id:"t",name:"Team",role:"owner"},capabilities:[],
    }});
    if (path === "/api/v1/integrations") return route.fulfill({json:{linear:null,clickup:null,exeConnections:[],ampConnections:[],cloudflareTail:{installations:[]}}});
    if (path === "/api/v1/fly/connection") return route.fulfill({json:{connection:null}});
    if (path === "/api/v1/integrations/bearer") return route.fulfill({json:{integrations:[],revision:0}});
    if (path === "/api/v1/x/connections" || path === "/api/v1/integrations/cloudflare") return route.fulfill({json:{connections:[]}});
    if (path === "/api/v1/integrations/ghcr") {
      if (route.request().method() === "GET") return route.fulfill({json:record ? [record] : []});
      const input = route.request().postDataJSON();
      expect(input).toEqual({image:"owner/private-image",username:"owner",token});
      record = {id:"18bc39f6-9385-49ee-b595-c9ee4f7837f5",image:input.image,username:input.username,revision:0};
      return route.fulfill({status:201,json:record});
    }
    return route.fulfill({json:[]});
  });
  await page.goto(origin+"/integrations");
  await page.getByRole("button",{name:"Add GitHub Container Registry integration"}).click();
  const form = page.getByRole("dialog",{name:"Add GitHub Container Registry integration"});
  await form.getByLabel("Image",{exact:true}).fill("owner/private-image");
  await form.getByLabel("GitHub username").fill("owner");
  const secret = form.getByLabel("Classic personal access token");
  await expect(secret).toHaveAttribute("type","password");
  await secret.fill(token);
  await form.getByRole("button",{name:"Save connection"}).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByText("owner/private-image",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:/Actions for GitHub Container Registry.*owner\/private-image/}).click();
  await page.getByRole("menuitem",{name:"Replace token"}).click();
  const replace = page.getByRole("dialog",{name:"Replace GitHub Container Registry token"});
  await expect(replace.getByLabel("Image",{exact:true})).toBeDisabled();
  await expect(replace.getByLabel("Classic personal access token")).toHaveValue("");
});
