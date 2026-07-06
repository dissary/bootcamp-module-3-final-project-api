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

// get user booking

app.get('/bookings/:user_id', async (req, res) => {
  const client = await pool.connect();
  const { user_id } = req.params

  try {

    const result = await client.query(`
      SELECT
          bookings.id,
          bookings.user_id,
          bookings.class_id,
          users.username,
          classes.title,
          classes.instructor,
          classes.start_time,
          classes.capacity,
          classes.duration,
          bookings.booking_status,
          (
            SELECT COUNT(*)
            FROM bookings b
            WHERE b.class_id = bookings.class_id
              AND b.booking_status = true
          ) AS total_bookings
      FROM bookings
      INNER JOIN users
        ON bookings.user_id = users.id
      INNER JOIN classes
        ON bookings.class_id = classes.id
      WHERE bookings.user_id = $1
    `, [user_id]);

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).send("Get user bookings error");
  } finally {
    client.release();
  }
});


// get all bookings

app.get('/bookings', async (req, res) => {
  const client = await pool.connect();

  try {

    const result = await client.query(`
    SELECT
        bookings.id,
        bookings.user_id,
        bookings.class_id,
        users.username,
        classes.title,
        classes.instructor,
        classes.start_time,
        bookings.booking_status
    FROM bookings
    INNER JOIN users ON bookings.user_id = users.id
    INNER JOIN classes ON bookings.class_id = classes.id
    `);

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).send("Get all bookings error");
  } finally {
    client.release();
  }
});

// Get All bookings on Class ID

app.get('/classes/:class_id/bookings', async(req, res) => {
  const { class_id } = req.params;
  const client = await pool.connect();

  try {
    const bookings = await client.query(`
      SELECT
        users.username,
        classes.title,
        classes.instructor,
        classes.start_time,
        bookings.booking_status
      FROM bookings
      INNER JOIN users ON bookings.user_id = users.id
      INNER JOIN classes ON bookings.class_id = classes.id
      WHERE bookings.class_id = $1
      `, [class_id])

    if (bookings.rows.length === 0) {
      return res.status(404).json({
        message: "No bookings found for this class"
      });
    }

      res.json(bookings.rows)
  } catch (error) {
    console.error(error);
    res.status(500).send("Get bookings class info error");
  } finally {
    client.release();
  }
})

// delete booking (unbook a class)
app.delete('/bookings/:user_id/:class_id', async (req, res) => {
  const client = await pool.connect();
    const { user_id, class_id } = req.params

  try {

    const result = await client.query(`DELETE FROM bookings WHERE user_id = $1 AND class_id = $2 RETURNING *`,[user_id, class_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    res.json({
      message: "Booking cancelled successfully"
    });

  }  catch (error) {
    console.error(error);
    res.status(500).send("delete bookings error");
  } finally {
    client.release();
  }
})

// Book Classes

app.post('/bookings', async (req, res) => {
  const client = await pool.connect();

  try {
    const { user_id, class_id } = req.body;

    if (!user_id || !class_id) {
      return res.status(400).json({
        message: "user_id and class_id are required"
      });
    }

    const userCheck = await client.query(
      'SELECT id FROM users WHERE id = $1',
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    const classCheck = await client.query(
      'SELECT id FROM classes WHERE id = $1',
      [class_id]
    );

    if (classCheck.rows.length === 0) {
      return res.status(404).json({
        message: "Class not found"
      });
    }

    const result = await client.query(
      `INSERT INTO bookings (user_id, class_id)
       VALUES ($1, $2)
       RETURNING *`,
      [user_id, class_id]
    );

    return res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error(error);

    if (error.code === '23505') {
      return res.status(400).json({
        message: "You already booked this class"
      });
    }

    return res.status(500).json({
      message: "Server error while creating booking"
    });

  } finally {
    client.release();
  }
});

// Show all Classes

app.get('/classes', async (req, res) => {
  const client = await pool.connect();
  const { user_id } = req.query;

  try {
    const query = `
      SELECT
        classes.*,
        COUNT(CASE WHEN bookings.booking_status = true THEN 1 END) AS total_bookings,
        MAX(CASE WHEN bookings.user_id = $1 THEN 1 ELSE 0 END) AS is_booked
      FROM classes
      LEFT JOIN bookings
        ON classes.id = bookings.class_id
      GROUP BY classes.id
      ORDER BY classes.id
    `;

    const result = await client.query(query, [user_id]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Show all class error occurred.');
  } finally {
    client.release();
  }
});

// Create Classes

app.post('/classes', async(req, res) => {
  const client = await pool.connect();

  try {
      const {
      title,
      description,
      instructor,
      start_time,
      duration,
      capacity
    } = req.body;

    if (!title || !instructor || !start_time || !duration || !capacity) {
      return res.status(400).json({ message: "Missing required fields"})
    }

    const result = await client.query(
      `INSERT INTO classes (title, description, instructor, start_time, duration, capacity)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description, instructor, start_time, duration, capacity]
    )

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).send("Create class error");
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