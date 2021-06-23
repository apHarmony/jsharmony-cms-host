# jsharmony-cms-host
jsHarmony CMS Host

## Installation

1. Install the jsHarmony CMS Host, if not already installed
   ````
   npm install -g jsharmony-cms-host
   ````
   
2. Create an empty folder
   ````
   mkdir cms-files
   cd cms-files
   ````
   
3. Run the jsHarmony CMS Host
   ````
   jsharmony-cms-host demo.site.jsharmony.com .
   ````
   Keep the program running.
   This will connect to the CMS server (in this case demo&period;site&period;jsharmony&period;com), and wait for files to get sent via publish.

   See below for additional command line parameters and flags.  User and password can be specified in the command line.
   
4. Add a new Deployment Target, selecting the following options:
   ````
   Deployment Type: CMS Deployment Host

   Host ID: [Click Browse to select Name of Computer]
   ````
  
5. Publish your CMS Branch to the new Deployment Target.  The jsharmony-cms-host program should download the files into the new "cms-files" folder from step 2.


## Usage

```
------------------------
:::jsHarmony CMS Host:::
------------------------
Usage: jsharmony-cms-host [cms_url] [target_path] [options]

cms_url       - URL to the CMS server, ex: https://instance.example.com:3000
target_path   - Location where CMS files will be copied.  Use "." for current directory

The following options are available:

--user [username]            - CMS server login username
--password [password]        - CMS server login password
--host-id [host_id]          - ID of the host, to be displayed in the CMS deployment wizard
                                 If not specified, current machine name will be used
--log [log_path]             - Log messages and errors to target path
--delete-excess-files        - Delete excess files in target_path that are not in the publish build
--overwrite-all              - Always replace all local files, instead of comparing size and MD5
--ignore-cert-errors         - Ignore Certificate Errors (ex. for self-signed certificates)
--ignore-path [path]         - Ignore a file or folder:
                                 folder/   (folder anywhere)
                                 file.txt  (file.txt anywhere)
                                 /folder/  (folder in root)
                                 /file.txt (file.txt in root)
--download [deployment_id]   - Download an individual deployment