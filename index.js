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
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  // console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    // console.log(decoded)
    next()
  } catch (err) {
    // console.log(err)
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
    const bookingsCollection = db.collection('bookings')

    // role middlewares
    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail
      const user = await usersCollection.findOne({ email })
      if (user?.role !== 'admin')
        return res
          .status(403)
          .send({ message: 'Admin only Actions!', role: user?.role })

      next()
    }

    const verifyDecorator = async (req, res, next) => {
      const email = req.tokenEmail
      // console.log(email)
      const user = await usersCollection.findOne({ email })
      // console.log(user)
      if (user?.role !== 'decorator')
        return res
          .status(403)
          .send({ message: 'Decorator only Actions!', role: user?.role })

      next()
    }
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

      const result = await decoratorsCollection.find().limit(5).toArray()
      res.send(result)

    })
    app.get('/decorators', async (req, res) => {

      const result = await decoratorsCollection.find({ status: 'available' }).toArray()
      res.send(result)

    })
    app.get('/decorators-all', async (req, res) => {

      const result = await decoratorsCollection.find().toArray()
      res.send(result)

    })


    // save or update a user in db
    app.post('/user', async (req, res) => {
      const userData = req.body
      userData.created_at = new Date().toLocaleDateString()
      userData.last_loggedIn = new Date().toLocaleDateString()
      userData.role = 'user'
      userData.status = 'active'

      const query = {
        email: userData.email,
      }

      const alreadyExists = await usersCollection.findOne(query)

      if (alreadyExists) {
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        })
        return res.send(result)
      }
      const result = await usersCollection.insertOne(userData)
      res.send(result)
    })

    // get a user's role
    app.get('/user/role', verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail })
      res.send({ role: result?.role })
    })

    // my bookings
    app.get('/my-bookings', verifyJWT, async (req, res) => {
      const result = await bookingsCollection
        .find({ customer: req.tokenEmail })
        .toArray()
      res.send(result)
    })
    // manage bookings
    app.get('/admin/bookings', verifyJWT, verifyADMIN, async (req, res) => {
      const user = await usersCollection.findOne({ email: req.tokenEmail });

      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden' });
      }
      const result = await bookingsCollection
        .find()
        .toArray()
      res.send(result)
    })


    // status update(bookings and decarators) 
    app.patch('/admin/assign-decorator/:id', verifyJWT, verifyADMIN, async (req, res) => {
      const bookingId = req.params.id
      const { decoratorId, decoratorName, decoratorEmail } = req.body


      const bookingUpdate = await bookingsCollection.updateOne(
        { _id: new ObjectId(bookingId) },
        {
          $set: {
            decoratorId,
            decoratorName,
            decoratorEmail,
            status: 'assigned',
          },
        }
      )


      if (bookingUpdate.modifiedCount === 0) {
        return res.status(400).send({ message: 'Booking not updated' })
      }


      const result = await decoratorsCollection.updateOne(
        { _id: new ObjectId(decoratorId) },
        {
          $set: { status: 'assigned' },
        }
      )

      res.send(result)
    }
    )

    app.patch('/admin/decorators/status/:id', verifyJWT, verifyADMIN, async (req, res) => {

      const id = req.params.id
      const { status } = req.body
      const result = await decoratorsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status } })

      res.send(result)
    })

    // Manage Services for admin
    app.get('/admin/services', verifyJWT, verifyADMIN, async (req, res) => {
      const result = await servicesCollection.find().toArray()
      res.send(result)
    })

    app.patch('/admin/services/:id', verifyJWT, verifyADMIN, async (req, res) => {
      const id = req.params.id
      const updatedData = req.body

      const result = await servicesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      )

      res.send(result)
    })

    app.post('/admin/services', verifyJWT, verifyADMIN, async (req, res) => {
      const service = req.body
      service.createdAt = new Date().toLocaleDateString()

      const result = await servicesCollection.insertOne(service)
      res.send(result)
    })

    app.delete('/admin/services/:id', verifyJWT, verifyADMIN, async (req, res) => {
      const id = req.params.id

      const result = await servicesCollection.deleteOne({
        _id: new ObjectId(id)
      })

      res.send(result)
    })

    // users for admin
    app.get('/admin/users', verifyJWT, verifyADMIN, async (req, res) => {
      const users = await usersCollection.find().toArray()
      res.send(users)
    })

    app.patch('/admin/users/status/:id', verifyJWT, verifyADMIN, async (req, res) => {
      const id = req.params.id
      const { status } = req.body
      console.log(req.params.id)

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      )

      res.send(result)
    })


    app.patch('/admin/users/role/:id', verifyJWT, verifyADMIN, async (req, res) => {
      const id = req.params.id
      const { role } = req.body
      console.log('REQ BODY:', req.body)
      console.log('REQ PARAM:', req.params.id)
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      )

      res.send(result)
    })

    app.delete('/admin/users/delete/:id', verifyJWT, verifyADMIN, async (req, res) => {
      const id = req.params.id

      const result = await usersCollection.deleteOne({
        _id: new ObjectId(id)
      })

      res.send(result)
    })

    app.post('/admin/decorators', verifyJWT, verifyADMIN, async (req, res) => {
  const decorator = req.body

  
  const exists = await decoratorsCollection.findOne({
    email: decorator.email,
  })

  if (exists) {
    return res.status(400).send({ message: 'Decorator already exists' })
  }

  const newDecorator = {
    name: decorator.name,
    email: decorator.email,
    image: decorator.image || '',
    specialties: decorator.specialties || [],
    status: 'available',
    createdAt: new Date().toLocaleDateString,
  }

  const result = await decoratorsCollection.insertOne(newDecorator)
  res.send(result)
})


    //admin statics
    app.get('/admin/stats', verifyJWT, verifyADMIN, async (req, res) => {

      const totalBookings = await bookingsCollection.countDocuments()

      const totalServices = await servicesCollection.countDocuments()

      const totalDecorators = await decoratorsCollection.countDocuments()

      const revenueResult = await bookingsCollection.aggregate([
        {
          $group: { _id: null, totalRevenue: { $sum: '$price' } }

        }
      ]).toArray()

      res.send({
        totalBookings,
        totalServices,
        totalDecorators,
        totalRevenue: revenueResult[0]?.totalRevenue || 0,
      })
    })

    // decorator statics
    app.get('/decorator/stats', verifyJWT, verifyDecorator, async (req, res) => {
      const email = req.tokenEmail

      const assigned = await bookingsCollection.countDocuments({
        decoratorEmail: email,
        status: 'assigned',
      })

      const ongoing = await bookingsCollection.countDocuments({
        decoratorEmail: email,
        status: 'ongoing',
      })

     


      const completedBookings = await bookingsCollection
      .find({
        status: 'completed',
        decoratorEmail: email,
      })
      .toArray()

      let totalDecoratorEarn = 0

    const earnings = completedBookings.map((booking) => {
      const price = booking.price || 0
      const decoratorEarn = price * 0.7

      totalDecoratorEarn += decoratorEarn

      return {
        _id: booking._id,
        serviceName: booking?.name,
        price,
        decoratorEarn,
      }
    })

      

      res.send({
        assigned,
        ongoing,
        completedBookings: completedBookings.length,
        earnings: Number(totalDecoratorEarn.toFixed(2)),
        // 
      })
    }
    )

    // decorator's page
    app.get('/decorator/projects', verifyJWT, verifyDecorator, async (req, res) => {
      const email = req.query.email

      const result = await bookingsCollection.find({
        decoratorEmail: email,
      }).toArray()

      res.send(result)
    })

    app.patch('/decorator/projects/status/:id', verifyJWT, verifyDecorator, async (req, res) => {
      const id = req.params.id
      const { status } = req.body

      const bookingResult = await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      )

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      })

      if (!booking) {
        return res.status(404).send({ message: 'Booking not found' })
      }

      let decoratorStatus = 'available'

    if (status === 'ongoing') {
      decoratorStatus = 'busy'
    }
    if (status === 'completed') {
      decoratorStatus = 'available'
    }

      const decoratorResult = await decoratorsCollection.updateOne(
        { email: booking.decoratorEmail },
        { $set: { status: decoratorStatus } }
      )

      res.send(bookingResult, decoratorResult)
    })

app.get('/decorator/earnings', verifyJWT,verifyDecorator,async (req, res) => {
    const decoratorEmail = req.tokenEmail

    const completedBookings = await bookingsCollection
      .find({
        status: 'completed',
        decoratorEmail: decoratorEmail,
      })
      .toArray()

    let totalDecoratorEarn = 0

    const earnings = completedBookings.map((booking) => {
      const price = booking.price || 0
      const decoratorEarn = price * 0.7

      totalDecoratorEarn += decoratorEarn

      return {
        _id: booking._id,
        serviceName: booking?.name,
        price,
        decoratorEarn,
      }
    })

    res.send({
      totalDecoratorEarn,
      totalCompleted: earnings.length,
      earnings,
    })
  }
)

    
    // payment history
    app.get('/payments', verifyJWT, async (req, res) => {
      const email = req.query.email
      const query = {}

      if (email) {
        if (email !== req.tokenEmail) {
          return res.status(403).send({ message: 'forbidden access' })
        }
        query.customer = email
      }

      const result = await bookingsCollection
        .find(query)
        .toArray()

      res.send(result)
    })

    // cancel booking (status update)
    app.patch('/my-bookings/cancel/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        return res.status(404).send({ message: 'Booking not found' });
      }

      // security check
      if (booking.customer !== req.tokenEmail) {
        return res.status(403).send({ message: 'Forbidden access' });
      }

      // already cancelled check
      if (booking.status === 'cancelled') {
        return res.send({ message: 'Already cancelled' });
      }

      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: new Date().toLocaleDateString(),
          },
        }
      );

      res.send(result);
    });


    // Payment 
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body
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

    app.post('/payment-success', async (req, res) => {
      const { sessionId } = req.body
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      const service = await servicesCollection.findOne({
        _id: new ObjectId(session.metadata.serviceId),
      })
      const payment = await bookingsCollection.findOne({
        transactionId: session.payment_intent,
      })

      if (session.status === 'complete' && service && !payment) {
        // save order data in db
        const paymentInfo = {
          serviceId: session.metadata.serviceId,
          transactionId: session.payment_intent,
          customer: session.metadata.customer,
          status: 'pending',
          paidAt: new Date().toLocaleDateString(),
          name: service.name,
          category: service.category,
          quantity: 1,
          price: session.amount_total / 100,
          image: service?.image,
        }
        const result = await bookingsCollection.insertOne(paymentInfo)
        // update plant quantity
        // await plantsCollection.updateOne(
        //   {
        //     _id: new ObjectId(session.metadata.plantId),
        //   },
        //   { $inc: { quantity: -1 } }
        // )

        return res.send({
          transactionId: session.payment_intent,
          bookingId: result.insertedId,
        })
      }
      res.send(
        res.send({
          transactionId: session.payment_intent,
          bookingId: payment._id,
        })
      )
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
