// Generated by CoffeeScript 1.3.3
var QuizRoom, app, checkAnswer, cumsum, express, fs, io, port, questions, rooms, syllables,
  __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

express = require('express');

app = express.createServer(express.logger());

io = require('socket.io').listen(app);

io.configure(function() {
  return io.set("log level", 2);
});

fs = require('fs');

checkAnswer = require('./answerparse').checkAnswer;

syllables = require('./syllable').syllables;

questions = [];

fs.readFile('sample.txt', 'utf8', function(err, data) {
  var line;
  if (err) {
    throw err;
  }
  return questions = (function() {
    var _i, _len, _ref, _results;
    _ref = data.split("\n");
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      line = _ref[_i];
      _results.push(JSON.parse(line));
    }
    return _results;
  })();
});

app.set('views', __dirname);

app.set('view options', {
  layout: false
});

app.use(require('less-middleware')({
  src: __dirname
}));

app.use(express["static"](__dirname));

cumsum = function(list, rate) {
  var num, sum, _i, _len, _results;
  sum = 0;
  _results = [];
  for (_i = 0, _len = list.length; _i < _len; _i++) {
    num = list[_i];
    _results.push(sum += Math.round(num) * rate);
  }
  return _results;
};

QuizRoom = (function() {

  function QuizRoom(name) {
    this.name = name;
    this.answer_duration = 1000 * 5;
    this.time_offset = 0;
    this.new_question();
    this.attempt = null;
    this.freeze();
  }

  QuizRoom.prototype.time = function() {
    if (this.time_freeze) {
      return this.time_freeze;
    } else {
      return this.serverTime() - this.time_offset;
    }
  };

  QuizRoom.prototype.serverTime = function() {
    return +(new Date);
  };

  QuizRoom.prototype.freeze = function() {
    return this.time_freeze = this.time();
  };

  QuizRoom.prototype.unfreeze = function() {
    if (this.time_freeze) {
      this.set_time(this.time_freeze);
      return this.time_freeze = 0;
    }
  };

  QuizRoom.prototype.set_time = function(ts) {
    return this.time_offset = new Date - ts;
  };

  QuizRoom.prototype.pause = function() {
    if (!(this.attempt || this.time() > this.end_time)) {
      return this.freeze();
    }
  };

  QuizRoom.prototype.unpause = function() {
    if (!this.attempt) {
      return this.unfreeze();
    }
  };

  QuizRoom.prototype.timeout = function(metric, time, callback) {
    var diff,
      _this = this;
    diff = time - metric();
    if (diff < 0) {
      return callback();
    } else {
      return setTimeout(function() {
        return _this.timeout(metric, time, callback);
      }, diff);
    }
  };

  QuizRoom.prototype.new_question = function() {
    var cumulative, list, question, rate, word, _ref;
    this.attempt = null;
    this.begin_time = this.time();
    question = questions[Math.floor(questions.length * Math.random())];
    this.info = {
      category: question.category,
      difficulty: question.difficulty,
      tournament: question.tournament,
      num: question.question_num,
      year: question.year,
      round: question.round
    };
    this.question = question.question.replace(/FTP/g, 'For 10 points').replace(/^\[.*?\]/, '').replace(/\n/g, ' ');
    this.answer = question.answer.replace(/\<\w\w\>/g, '').replace(/\[\w\w\]/g, '');
    this.timing = {
      list: (function() {
        var _i, _len, _ref, _results;
        _ref = this.question.split(" ");
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          word = _ref[_i];
          _results.push(syllables(word));
        }
        return _results;
      }).call(this),
      rate: 1000 * 60 / 2 / 250
    };
    _ref = this.timing, list = _ref.list, rate = _ref.rate;
    cumulative = cumsum(list, rate);
    this.end_time = this.begin_time + cumulative[cumulative.length - 1] + this.answer_duration;
    return this.sync(true);
  };

  QuizRoom.prototype.skip = function() {
    return this.new_question();
  };

  QuizRoom.prototype.emit = function(name, data) {
    return io.sockets["in"](this.name).emit(name, data);
  };

  QuizRoom.prototype.end_buzz = function(session) {
    var _ref;
    if (((_ref = this.attempt) != null ? _ref.session : void 0) === session) {
      this.attempt.final = true;
      this.attempt.correct = checkAnswer(this.attempt.text, this.answer);
      this.sync();
      this.unfreeze();
      if (this.attempt.correct) {
        io.sockets.socket(this.attempt.user).store.data.correct = (io.sockets.socket(this.attempt.user).store.data.correct || 0) + 1;
        this.set_time(this.end_time);
      } else if (this.attempt.interrupt) {
        io.sockets.socket(this.attempt.user).store.data.interrupts = (io.sockets.socket(this.attempt.user).store.data.interrupts || 0) + 1;
      }
      this.attempt = null;
      return this.sync();
    }
  };

  QuizRoom.prototype.buzz = function(user, fn) {
    var session,
      _this = this;
    if (this.attempt === null && this.time() <= this.end_time) {
      fn('http://www.whosawesome.com/');
      session = Math.random().toString(36).slice(2);
      this.attempt = {
        user: user,
        realTime: this.serverTime(),
        start: this.time(),
        duration: 8 * 1000,
        session: session,
        text: '',
        interrupt: this.time() < this.end_time - this.answer_duration,
        final: false
      };
      io.sockets.socket(user).store.data.guesses = (io.sockets.socket(user).store.data.guesses || 0) + 1;
      this.freeze();
      this.sync();
      return this.timeout(this.serverTime, this.attempt.realTime + this.attempt.duration, function() {
        return _this.end_buzz(session);
      });
    } else {
      return fn('narp');
    }
  };

  QuizRoom.prototype.guess = function(user, data) {
    var _ref;
    if (((_ref = this.attempt) != null ? _ref.user : void 0) === user) {
      this.attempt.text = data.text;
      if (data.final) {
        console.log('omg final clubs are so cool ~ zuck');
        return this.end_buzz(this.attempt.session);
      } else {
        return this.sync();
      }
    }
  };

  QuizRoom.prototype.sync = function(full) {
    var action, actionvotes, attr, blacklist, client, data, nay, vote, voting, yay, _i, _j, _k, _len, _len1, _len2, _ref, _ref1;
    data = {
      real_time: +(new Date),
      voting: {}
    };
    voting = ['skip', 'pause', 'unpause'];
    for (_i = 0, _len = voting.length; _i < _len; _i++) {
      action = voting[_i];
      yay = 0;
      nay = 0;
      actionvotes = [];
      _ref = io.sockets.clients(this.name);
      for (_j = 0, _len1 = _ref.length; _j < _len1; _j++) {
        client = _ref[_j];
        vote = client.store.data[action];
        if (vote === 'yay') {
          yay++;
          actionvotes.push(client.id);
        } else {
          nay++;
        }
      }
      if (actionvotes.length > 0) {
        data.voting[action] = actionvotes;
      }
      if (yay / (yay + nay) > 0) {
        _ref1 = io.sockets.clients(this.name);
        for (_k = 0, _len2 = _ref1.length; _k < _len2; _k++) {
          client = _ref1[_k];
          client.del(action);
        }
        this[action]();
      }
    }
    blacklist = ["name", "question", "answer", "timing", "voting", "info"];
    for (attr in this) {
      if (typeof this[attr] !== 'function' && __indexOf.call(blacklist, attr) < 0) {
        data[attr] = this[attr];
      }
    }
    if (full) {
      data.question = this.question;
      data.answer = this.answer;
      data.timing = this.timing;
      data.info = this.info;
      data.users = (function() {
        var _l, _len3, _ref2, _results;
        _ref2 = io.sockets.clients(this.name);
        _results = [];
        for (_l = 0, _len3 = _ref2.length; _l < _len3; _l++) {
          client = _ref2[_l];
          _results.push({
            id: client.id,
            name: client.store.data.name,
            interrupts: client.store.data.interrupts || 0,
            correct: client.store.data.correct || 0,
            guesses: client.store.data.guesses || 0
          });
        }
        return _results;
      }).call(this);
    }
    return io.sockets["in"](this.name).emit('sync', data);
  };

  return QuizRoom;

})();

rooms = {};

io.sockets.on('connection', function(sock) {
  var room,
    _this = this;
  room = null;
  sock.on('join', function(data) {
    var room_name;
    if (data.old_socket && io.sockets.socket(data.old_socket)) {
      io.sockets.socket(data.old_socket).disconnect();
    }
    room_name = data.room_name;
    sock.set('name', data.public_name);
    sock.join(room_name);
    if (!(room_name in rooms)) {
      rooms[room_name] = new QuizRoom(room_name);
    }
    room = rooms[room_name];
    room.sync(true);
    return room.emit('introduce', {
      user: sock.id
    });
  });
  sock.on('echo', function(data, callback) {
    return callback(+(new Date));
  });
  sock.on('rename', function(name) {
    sock.set('name', name);
    if (room) {
      return room.sync(true);
    }
  });
  sock.on('skip', function(vote) {
    sock.set('skip', vote);
    if (room) {
      return room.sync();
    }
  });
  sock.on('pause', function(vote) {
    sock.set('pause', vote);
    if (room) {
      return room.sync();
    }
  });
  sock.on('unpause', function(vote) {
    sock.set('unpause', vote);
    if (room) {
      return room.sync();
    }
  });
  sock.on('buzz', function(data, fn) {
    if (room) {
      return room.buzz(sock.id, fn);
    }
  });
  sock.on('guess', function(data) {
    if (room) {
      return room.guess(sock.id, data);
    }
  });
  sock.on('chat', function(_arg) {
    var final, session, text;
    text = _arg.text, final = _arg.final, session = _arg.session;
    if (room) {
      return room.emit('chat', {
        text: text,
        session: session,
        user: sock.id,
        final: final
      });
    }
  });
  return sock.on('disconnect', function() {
    var id;
    id = sock.id;
    console.log("someone", id, "left");
    return setTimeout(function() {
      console.log(!!room, 'rooms');
      if (room) {
        room.sync(true);
        return room.emit('leave', {
          user: id
        });
      }
    }, 100);
  });
});

app.get('/:channel', function(req, res) {
  var name;
  name = req.params.channel;
  return res.render('index.jade', {
    name: name
  });
});

app.get('/', function(req, res) {
  var noun, people, pick, verb;
  people = 'kirk,feynman,huxley,robot,ben,batman,panda,pinkman,superhero,celebrity,traitor,alien,lemon,police,whale,astronaut';
  verb = 'on,enveloping,eating,drinking,in,near,sleeping,destruction,arresting,cloning,around,jumping,scrambling';
  noun = 'mountain,drugs,house,asylum,elevator,scandal,planet,school,brick,lamp,water,paper,friend,toilet,airplane,cow,pony';
  pick = function(list) {
    var n;
    n = list.split(',');
    return n[Math.floor(n.length * Math.random())];
  };
  return res.redirect('/' + pick(people) + "-" + pick(verb) + "-" + pick(noun));
});

port = process.env.PORT || 5000;

app.listen(port, function() {
  return console.log("listening on", port);
});
