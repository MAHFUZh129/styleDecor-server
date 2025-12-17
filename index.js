require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const admin = require('firebase-admin')
const port = process.env.PORT || 3000
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8')
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const app = express()
// middleware
app.use(
  cors({
    origin:[process.env.CLIENT_DOMAIN],
    credentials: true,
    optionSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    console.log(decoded)
    next()
  } catch (err) {
    console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {

  try {

    const db = client.db('StyleDecor')
    const servicesCollection = db.collection('services')
    const usersCollection = db.collection('users')
    const decoratorsCollection = db.collection('decorators')

    // sevices from db
    app.get('/services', async (req, res) => {

      const result = await servicesCollection.find().limit(6).toArray()
      res.send(result)

    })
    app.get('/services-all', async (req, res) => {

      const result = await servicesCollection.find().toArray()
      res.send(result)

    })

    app.get('/services/:id', async (req, res) => {
      const id = req.params.id
      const result = await servicesCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
      // console.log(result)
    })

    // decorators from db
    app.get('/top-decorators', async (req, res) => {

      const result = await decoratorsCollection.find().toArray()
      res.send(result)

    })


    // save or update a user in db
    app.post('/user', async (req, res) => {
      const userData = req.body
      userData.created_at = new Date().toISOString()
      userData.last_loggedIn = new Date().toISOString()
      userData.role = 'user'

      const query = {
        email: userData.email,
      }

      const alreadyExists = await usersCollection.findOne(query)
      // console.log('User Already Exists---> ', !!alreadyExists)

      if (alreadyExists) {
        // console.log('Updating user info......')
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        })
        return res.send(result)
      }

      // console.log('Saving new user info......')
      const result = await usersCollection.insertOne(userData)
      res.send(result)
    })


    // Payment endpoints
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body
      console.log(paymentInfo)
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'bdt',
              product_data: {
                name: paymentInfo?.name,
                description: paymentInfo?.description,
                images: [paymentInfo.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
       customer_email: paymentInfo?.customer?.email,
        mode: 'payment',
        metadata: {
          serviceId: paymentInfo?.serviceId,
          customer: paymentInfo?.customer.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/service/${paymentInfo?.serviceId}`,
      })
      res.send({ url: session.url })
    })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
