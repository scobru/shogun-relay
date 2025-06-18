// Simple Gun unauthenticated server
import { gun, namespace } from './gun.js'
import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

// ES Module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3001
const publicPath = path.resolve(__dirname, 'public')
const indexPath = path.resolve(publicPath, 'index.html')

// static resources should just be served as they are
app.use(express.static(publicPath))

const cleanReturnString = value => {
   if (!value) return ''
   return value.replace(/"/g, `'`)
}

app.get('/blog/:id', (req, res) => {
   const htmlData = fs.readFileSync(indexPath, 'utf8')
   console.log('blog/:id', req.params.id)
   let numberOfTries = 0
   const chain = gun
      .get(`${namespace}/post`)
      .get(req.params.id)
      .on(post => {
         console.log('post', post)
         numberOfTries++
         if (!post) {
            if (numberOfTries > 1) {
               chain.off()
               return res.sendStatus(404)
            }
            return
         }
         if (res.writableEnded) {
            chain.off()
            return
         }
         // Replace the placeholder in public/index.html with the post content
         const finalHtml = `
            <!DOCTYPE html>
            <html>
               <head>
                  <title>${post.title || 'Blog Post'}</title>
                  <meta name="description" content="${cleanReturnString(
                     post.description || ''
                  )}" />
               </head>
               <body>
                  ${post.content}
               </body>
            </html>
         `
         return res.send(finalHtml)
      })
   setTimeout(() => {
      chain.off()
      if (res.writableEnded) {
         return
      }
      res.sendStatus(408)
   }, 5000)
})

app.get('/*', (req, res) => {
   res.sendFile(indexPath)
})


app.listen(PORT, error => {
   if (error) {
      return console.log('Error during app startup', error)
   }
   console.log('listening on ' + PORT + '...')
})


