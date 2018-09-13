// import FFMPEG from './FFMPEGMan';
import fs from 'fs';
import { DateTime } from 'luxon';
import * as timeHelpers from './timeHelpers';
import FFMPEG from './FFMPEGMan';

class Scheduler {
    instances = {};

    constructor(stream, schedulerSettings, ffmpegSettings) {
        this.stream = stream;
        this.settings = schedulerSettings;
        this.FFMPEGSettings = ffmpegSettings;
        this.timeOutID = null;
        this.addedPreDurationSecs = 0;

        // initiate
        // console.log(`\nScheduler_${this.stream.name} is initiated!`);
        if (this.stream.record) {
            this.initSchedule();
        }
    }

    initSchedule = () => {
        // console.log(`Scheduler_${this.stream.name} is initiating!`);
        
        // schedule next record
        this.scheduleRecord();
    }

    createInstance() {
        // generate random intsance id
        const id = `_${Math.random().toString(36).substr(2, 12)}`;
        // generate new instance
        const ffmpeg = new FFMPEG(id, this.stream, this.FFMPEGSettings);
        // create recInstance
        const recInstance = {
            id,
            ffmpeg,
            files: [],
        };

        return recInstance;
    }

    // returns ffmpegInstance or undefined
    findInstance(id = null) {
        if (!id) throw Error('id not set');

        if (!this.instances.length === 0) return undefined;

        // if key in object exists return value
        if (Object.prototype.hasOwnProperty.call(this.instances, id)) {
            return this.instances[id];
        }

        return undefined;
    }

    getInstance(id = null) {
        // if id find on instances
        if (id) {
            return this.findInstance(id);
        }
        // if id is null create new one
        return this.createInstance();
    }

    addInstance(recInstance) {
        this.instances[recInstance.id] = recInstance;
    }

    removeInstance(id) {
        delete this.instances[id];
    }

    scheduleRecord = (instanceId = null, reSchedule = true) => {
        // get instance
        const recInstance = this.getInstance(instanceId);

        // console.log('\n\n[schduler.js] - scheduleRecord() ===============================');
        // console.log(`Started at: ${DateTime.local().toISOTime()}`);
        // if recording is not enabled return null
        if (!this.stream.record) {
            return;
        }

        // setting checks
        // check preDurationSecs
        if (this.settings.preDurationSecs > this.stream.recDuration) {
            throw Error('Error: Scheduler settings preDurationSecs is greater then stream duration!');
        }

        // check skipSecs
        if (this.settings.skipSecs > this.settings.preDurationSecs + this.stream.recDuration) {
            throw Error('Error: Scheduler settings skipSecs is greater then stream duration + scheduler preDurationSecs!');
        }

        // check stream record duration should be greater then 5secs
        if (this.stream.recDuration < 5) {
            throw Error('Error: Stream record duration should be greater then 5!');
        }

        // init properties
        const diffToNextTimeSlot =
            timeHelpers.diffToNextTimeSlotInSec(
                this.stream.recDuration,
                this.addedPreDurationSecs,
            );

        let { preDurationSecs, skipSecs } = this.settings;
        const { afterDurationSecs } = this.settings;

        // console.log('diffToNextTimeSlot: ', diffToNextTimeSlot);
        let nextInterval = diffToNextTimeSlot - preDurationSecs;
        
        if (nextInterval < 5) {
            nextInterval = diffToNextTimeSlot;
            preDurationSecs = 0;
            skipSecs = 0;
        }
        // console.log('Next interval In: ', nextInterval);

        // calculate record duration
        const recrodDuration =
            nextInterval +
            preDurationSecs +
            afterDurationSecs;

        // estimated end DateTime
        const estimatedEndDateTime =
            timeHelpers.convertSecondsToDateTime(
                timeHelpers.convertDateTimeToSeconds(DateTime.local()) +
                recrodDuration,
            );

        // calculate time
        const recProps = {
            skipSecs,
            duration: recrodDuration,
            startTime: timeHelpers.convertSecondsToDateTime(
                timeHelpers.currentTimeSlotInSec(this.stream.recDuration),
            ),
            estimatedEndDateTime,
        };

        // do not start recording if 
        if (recrodDuration > this.settings.dontRecordIfRemainingDuration) {
            // start recording
            this.record(recInstance, recProps);
        } else {
            // end this ass a successful record
            this.onSuccess(recInstance.id);
        }

        if (reSchedule) {
            // console.log('[schduler.js].scheduleRecord() -> Next record SCHEDULED!');
            // scheudle timout
            setTimeout(
                this.scheduleRecord,
                nextInterval * 1000,
            );
        }

        // set added preduraion
        this.addedPreDurationSecs = preDurationSecs;

        // heap used after every schedule
        const used = process.memoryUsage().heapUsed / 1024 / 1024;
        console.log('\x1b[32m%s\x1b[0m', 'The script uses approximately', (Math.round(used * 100) / 100), 'MB');
    }


    record(recInstance, recProps) {
        const { ffmpeg } = recInstance;

        // set error and sucess hooks
        ffmpeg.onSuccess((ffmpegMan) => {
           this.onSuccess(ffmpegMan.ID);
        });

        ffmpeg.onError((ffmpegMan, error) => {
            this.onError(ffmpegMan.ID, error);
        });

        // call record on ffmpeg
        ffmpeg.record(recProps);

        // push it to instances
        this.addInstance(recInstance);
    }

    // on record success
    onSuccess = (instanceID) => {
        // console.log(`[Schedule.js].record -> ${instanceID} finished recording`);
        // get instance by id
        const instance = this.getInstance(instanceID);

        // if there are more then one file per timeslot
        // write a json
        if (instance && instance.files.length > 0) {
            instance.files.push({
                outputPath: instance.ffmpeg.outputPath,
                outputDirectory: instance.ffmpeg.outputDirectory,
                outputFileName: instance.ffmpeg.outputFileName,
            });

            const content = JSON.stringify(instance.files);

            const jsonFileName = `${instance.files[0].outputDirectory}\\${instance.files[0].outputFileName}.json`;

            // write information to json
            fs.writeFile(jsonFileName, content, 'utf8', (err) => {
                if (err) {
                    throw err;
                }
                // console.log(err);
            });
        }

        if (instance && instance.ffmpeg) {
            instance.ffmpeg.stopRecord(true);
        }

        this.removeInstance(instanceID);
    }

    // on record error
    onError = (instanceID) => {
        // console.log(`[Schedule.js].record -> ${instanceID} recording ERROR`);

        // reset hooks of instance
        const instance = this.getInstance(instanceID);
        instance.ffmpeg.resetHooks();

        instance.files.push({
            outputPath: instance.ffmpeg.outputPath,
            outputDirectory: instance.ffmpeg.outputDirectory,
            outputFileName: instance.ffmpeg.outputFileName,
        });

        setTimeout(() => {
            this.scheduleRecord(instanceID, false);
        }, this.settings.reScheduleTimeout * 1000);
    }

    stopSchedule = () => {
        // clear timer
        if (this.timeOutID) {
            clearTimeout(this.timeOutID);
            this.timeOutID = null;
        }

        // end ffmpeg
        throw Error('[Shcduler.js]->stopSchedule() UNIMPLEMENTED!');
    }
}

export default Scheduler;
