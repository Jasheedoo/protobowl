fs = require 'fs'
path = require 'path'
wrench = require 'wrench'
util = require 'util'

crypto = require 'crypto'

send_update = -> null
exports.watch = (fn) -> send_update = fn

less = require 'less'
	
Snockets = require 'snockets'
CoffeeScript = require 'coffee-script'

Snockets.compilers.coffee = 
	match: /\.js$/
	compileSync: (sourcePath, source) ->
		CoffeeScript.compile source, {filename: sourcePath, bare: true}

snockets = new Snockets()

recursive_build = (src, dest, cb) ->
	fs.stat dest, (err, deststat) ->
		if !err
			return wrench.rmdirRecursive dest, (err) ->
				recursive_build src, dest, cb
		fs.stat src, (err, srcstat) ->
			return cb(err) if err
			fs.mkdir dest, srcstat.mode, (err) ->
				return cb(err) if err
				fs.readdir src, (err, files) ->
					return cb(err) if err
					copyFiles = (err) ->
						return cb(err) if err
						filename = files.shift()
						return cb() if filename is null or typeof filename is 'undefined'
						
						# blacklist = ['README.md', 'build', 'node_modules', 'dev.js']

						file = src + '/' + filename
						destfile = dest + '/' + filename

						fs.stat file, (err, filestat) ->
							if filestat.isDirectory()
								recursive_build file, destfile, copyFiles
							else # no need to handle symbolic links
								fs.readFile file, 'utf-8', (err, data) ->
									build_file filename, data, (outfile, output) ->
										console.log dest + '/' + outfile
										fs.writeFile dest + '/' + outfile, output, copyFiles
					copyFiles()


build_file = (filename, data, callback) ->
	prefix = path.basename(filename, path.extname(filename))

	if path.extname(filename) is '.coffee'
		callback prefix + '.js', CoffeeScript.compile data, {filename: filename, bare: true}
	else
		callback filename, data

compile_server = ->
	recursive_build 'server', 'build/server', ->
		console.log 'done copying server'
	recursive_build 'shared', 'build/shared', ->
		console.log 'done copying shared'
	recursive_build 'static', 'build/static', ->
		console.log 'done copying static'


# simple helper function that hashes things
sha1 = (text) ->
	hash = crypto.createHash('sha1')
	hash.update(text + '')
	hash.digest('hex')




scheduledUpdate = null
path = require 'path'

updateCache = ->
	source_list = []
	compile_date = new Date
	timehash = ''
	cache_text = ''

	compileLess = ->
		lessPath = 'client/less/protobowl.less'
		fs.readFile lessPath, 'utf8', (err, data) ->
			throw err if err

			parser = new(less.Parser)({
				paths: [path.dirname(lessPath)],
				filename: lessPath
			})

			parser.parse data, (err, tree) ->
				css = tree?.toCSS {
					compress: false
				}

				source_list.push {
					hash: sha1(css + ''),
					code: "/* protobowl_css_build_date: #{compile_date} */\n#{css}",
					err: err,
					file: "static/protobowl.css"
				}
				compileCoffee()


	file_list = ['app', 'offline', 'auth']
	
	compileCoffee = ->
		file = file_list.shift()
		return saveFiles() if !file
		
		snockets.getConcatenation "client/#{file}.coffee", minify: false, (err, js) ->
			source_list.push {
				hash: sha1(js + ''),
				code: "protobowl_#{file}_build = '#{compile_date}';\n#{js}", 
				err: err, 
				file: "static/#{file}.js"
			}
			compileCoffee()

	saveFiles = ->
		# its something like a unitard
		unihash = sha1((i.hash for i in source_list).join(''))
		if unihash is timehash
			console.log 'files not modified; aborting'
			scheduledUpdate = null
			return
		error_message = ''
			
		console.log 'saving files'
		for i in source_list
			error_message += "File: #{i.file}\n#{i.err}\n\n" if i.err
		if error_message
			io.sockets.emit 'debug', error_message
			console.log error_message
			scheduledUpdate = null
		else
			saved_count = 0
			for i in source_list
				fs.writeFile i.file, i.code, 'utf8', ->
					saved_count++
					if saved_count is source_list.length
						writeManifest(unihash)


	writeManifest = (hash) ->
		data = cache_text.replace(/INSERT_DATE.*?\n/, 'INSERT_DATE '+(new Date).toString() + " # #{hash}\n")
		fs.writeFile 'static/offline.appcache', data, (err) ->
			throw err if err
			send_update()
			compile_server()
			scheduledUpdate = null

	fs.readFile 'static/offline.appcache', 'utf8', (err, data) ->
		cache_text = data
		timehash = cache_text.match(/INSERT_DATE (.*?)\n/)?[1]?.split(" # ")?[1]
		compileLess()
		

watcher = (event, filename) ->
	return if filename in ["offline.appcache", "protobowl.css", "app.js"]
		
	unless scheduledUpdate
		console.log "changed file", filename
		scheduledUpdate = setTimeout updateCache, 500


updateCache()

fs.watch "shared", watcher
fs.watch "client", watcher
fs.watch "client/less", watcher
fs.watch "client/lib", watcher
fs.watch "server/room.jade", watcher