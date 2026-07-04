let express = require("express");
let path = require("path");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { error } = require("console");
require("dotenv").config();
const { DATABASE_URL, SECRET_KEY } = process.env;

let app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function getPostgresVersion() {
  const client = await pool.connect();

  try {
    const response = await client.query('SELECT version()');
    console.log(response.rows[0]);
  } finally {
    client.release();
  }
}

getPostgresVersion();

// Get Users username (done)

app.get('/users/:user_id', async(req,res) => {
  const client =await pool.connect();
  const { user_id } = req.params;

  try {
    const result = await client.query(`SELECT username FROM users WHERE id = $1`
      , [user_id]
    )

    res.status(200).json(result.rows[0]);
  } catch(error) {
    console.error(error)
    res.status(404).send({ message: "Get username failed."})
  } finally {
    client.release();
  }
})

// Booking (DONE)

app.post('/bookings', async(req, res) => {
  const client = await pool.connect();
  const { class_id, user_id } = req.body;

  try { 
    const result = await client.query(`
      INSERT INTO bookings (user_id, class_id) VALUES ($1, $2) RETURNING *
      `, [user_id, class_id] )

    res.status(201).json({ message: "Booking successfully."})
  } catch(error) {
    console.error(error)
    res.status(400).send({ message: "Booking failed."})
  } finally {
    client.release();
  }
})

// Remove Booking (DONE)

app.delete('/classes/:class_id/:user_id', async(req, res) => {
  const client = await pool.connect();
  const { class_id, user_id } = req.params;

  try { 
    const result = await client.query(`
      DELETE FROM bookings WHERE class_id = $1 AND user_id = $2
      `, [class_id, user_id])

    res.status(201).json({ message: "Cancel booking successfully."})
  } catch(error) {
    console.error(error)
    res.status(400).send({ message: "Cancel booking failed."})
  } finally {
    client.release();
  }
})

// List User Bookings (Done)

app.get('/classes/booked/:user_id', async(req, res) => {
  const client = await pool.connect();
  const { user_id } = req.params;

  try {
    const result = await client.query(`
    SELECT
    classes.id,
    classes.title,
    classes.instructor,
    classes.start_time,
    classes.duration,
    classes.capacity,
    COUNT(bookings.id) AS total_bookings
    FROM classes
    INNER JOIN bookings
    ON classes.id = bookings.class_id
    WHERE bookings.user_id = $1
    GROUP BY
    classes.id,
    classes.title,
    classes.instructor,
    classes.start_time,
    classes.duration,
    classes.capacity;`
    , [user_id])
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(404).send({ message: "List All Bookings Error"})
  } finally {
    client.release();
  }
})

// List All Available Classes (DONE)

app.get('/classes', async (req, res) => {
  const client = await pool.connect();
  const { user_id } = req.query;

  try {
    const result = await client.query(`
      SELECT
        classes.id,
        classes.title,
        classes.instructor,
        classes.start_time,
        classes.duration,
        classes.capacity,
        COUNT(bookings.id) AS total_bookings,
        BOOL_OR(bookings.user_id = $1) AS is_booked
      FROM classes
      LEFT JOIN bookings
        ON classes.id = bookings.class_id
      GROUP BY classes.id
      ORDER BY classes.id;
    `, [user_id]);
    res.json(result.rows);
  } catch (error) {
    console.error(error)
    res.status(404).send({ message: "List All Classes Error"})
  } finally {
    client.release();
  }
})

// Sign Up

app.post('/signup', async (req, res) => {
  const client = await pool.connect();

  try {
    const { username, email, password, phone_number } = req.body;
    const hashedPassword = await bcrypt.hash(password, 12);

    const userResult = await client.query('SELECT * FROM users WHERE username = $1', [username]);

    if (userResult.rows.length > 0) {
      return res.status(400).json({ message: "Username is taken." });
    }

    if (!username || !email || !password || !phone_number) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const emailResult = await client.query('SELECT * FROM users WHERE email = $1', [email]);

    if (emailResult.rows.length > 0) {
      return res.status(400).json({ message: "Email is taken." });
    }

    await client.query('INSERT INTO users (username, email, password, phone_number) VALUES ($1, $2, $3, $4)'
      , [username, email, hashedPassword, phone_number]
    )

    res.status(201).json({ message: "Sign up successfully."})
  } catch(error) {
    console.error(error)
    res.status(500).send('Sign up error.');
  } finally {
    client.release();
  }
})

// Log In

app.post('/login', async(req, res) => {
  const client = await pool.connect();

  try {
    const { username, password } = req.body;
    const result = await client.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) return res.status(400).json({ message: "Username or password incorrect" });

    const passwordIsValid = await bcrypt.compare(password, user.password);

    if (!passwordIsValid) return res.status(401).json({ auth: false, token: null });

    var token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: 86400 });
    res.status(200).json({ auth: true, token: token });
  } catch(error) {
    console.error(error)
    res.status(500).send('Login error.');
  } finally {
    client.release();
  }
})

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(3000, () => {
  console.log("App is listening on port 3000");
});