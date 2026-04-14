这个文档可以支持用户把大纲内容以三种形式提交给程序，分别是：粘贴，选择单一文件， 和文件夹选择。 程序讲根据大纲文件生成指定格式的PPTX文件，其中包括了单词例句的音频带读，重点句型的音频带读，和针对对话单独生成的场景图片和对话音频， 每个音频都对应对话中的一句话。场景图片中有对话的连续音频。 
PPT中文本内容生成格式： 中文：微软雅黑 英文：Arial Black 字号：80 （行间距需用户手动调整）。 其中中文和英文的颜色是一一对应的。 例句只需要提供英文单词，程序会自动生成例句并做颜色匹配。 重点句和对话 中英文对照需要注意，中间用 半角字体的 | 隔开。 例如： I'm Michael. | 我是Michael 

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
